// QR Code Generator Web App

// ===== CONFIGURATION =====
// Google Gemini API Key for dynamic prompt generation
const GEMINI_API_KEY = 'AIzaSyARF154Yr51iU5n02cf2G-G5HFmJDv-OF4';
// Google Maps API Key for inline Place ID search.
// Requires: Maps JavaScript API + Places API (New) enabled in Google Cloud Console.
const GOOGLE_MAPS_API_KEY = 'AIzaSyARF154Yr51iU5n02cf2G-G5HFmJDv-OF4';
// Models to try in order (newest stable model first)
const GEMINI_MODELS = [
    'gemini-2.0-flash',         // Current stable flash model
    'gemini-2.0-flash-lite',    // Faster/lower-cost flash fallback
    'gemini-1.5-flash',         // Backward-compatible fallback
    'gemini-1.5-flash-latest'   // Legacy flash fallback
];
const GEMINI_API_BASES = [
    'https://generativelanguage.googleapis.com/v1',
    'https://generativelanguage.googleapis.com/v1beta'
];
const GEMINI_WORKING_MODEL_CACHE_KEY = 'geminiWorkingModelV1';
const GEMINI_WORKING_MODEL_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const GEMINI_DISCOVERY_REFRESH_MS = 6 * 60 * 60 * 1000; // 6 hours
const GEMINI_DISCOVERY_TIMEOUT_MS = 6000;
let discoveredGeminiModels = [];
let lastGeminiDiscoveryAt = 0;
let workingGeminiModel = loadCachedGeminiModel() || GEMINI_MODELS[0];
// =========================

let selectedLogo = null;
let currentQRDataURL = null;
let currentQRStyle = 'squares';
let currentDarkColor = '#000000';
let currentLightColor = '#ffffff';
let currentLabelColor = '#000000';
let isGoogleReviewMode = false;
let useGoogleColorsInLabel = true;
let currentErrorCorrectionLevel = 'H'; // L, M, Q, or H

// State history for undo/redo functionality
let stateHistory = [];
let currentStateIndex = -1;
const MAX_HISTORY = 50;
let isRestoringState = false; // Prevent saving during undo/redo

// Artistic QR Code variables
let backgroundImage = null;
let currentBlendMode = 'overlay';
let currentBgOpacity = 50;
let currentQrStrength = 80;
let isGeneratingAI = false;
let cancelAIGeneration = false;
let cancelBackupRenderer = false;
// Last AI generation metadata (used to embed into downloads)
let lastAiBackgroundMeta = null;
let lastGeneratedSuggestions = null; // Store all AI-generated suggestions

// --- Utility Functions --------------------
// Generate timestamp prefix for filenames: yyyy.mmm.dd-hh.mm
function getTimestampPrefix() {
    const now = new Date();
    const year = now.getFullYear();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[now.getMonth()];
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    
    return `${year}.${month}.${day}-${hours}.${minutes}`;
}

// --- PNG metadata helpers (insert/read tEXt chunk) --------------------
function crc32(buf) {
    const table = (function() {
        let c; const table = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            c = n;
            for (let k = 0; k < 8; k++) {
                c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
            }
            table[n] = c >>> 0;
        }
        return table;
    })();

    let crc = 0 ^ (-1);
    for (let i = 0; i < buf.length; i++) {
        crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
}

function createChunk(typeStr, dataBytes) {
    const typeBytes = new TextEncoder().encode(typeStr);
    const len = dataBytes ? dataBytes.length : 0;
    const chunk = new Uint8Array(4 + 4 + len + 4);
    // length
    const dv = new DataView(chunk.buffer);
    dv.setUint32(0, len);
    // type
    chunk.set(typeBytes, 4);
    // data
    if (len) chunk.set(dataBytes, 8);
    // crc over type+data
    const crcInput = new Uint8Array(typeBytes.length + len);
    crcInput.set(typeBytes, 0);
    if (len) crcInput.set(dataBytes, typeBytes.length);
    const crc = crc32(crcInput);
    dv.setUint32(8 + len, crc);
    return chunk;
}

function insertTextChunkToPNG(dataURL, key, value) {
    if (!dataURL.startsWith('data:image/png;base64,')) return dataURL;
    const b64 = dataURL.split(',')[1];
    const byteStr = atob(b64);
    const bytes = new Uint8Array(byteStr.length);
    for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);

    // PNG signature is 8 bytes
    const sig = 8;
    // Find IEND chunk index
    // iterate chunks
    let offset = sig;
    while (offset < bytes.length) {
        const dv = new DataView(bytes.buffer, offset, 8);
        const length = dv.getUint32(0);
        const type = String.fromCharCode(
            bytes[offset+4], bytes[offset+5], bytes[offset+6], bytes[offset+7]
        );
        if (type === 'IEND') break;
        offset += 8 + length + 4; // move to next chunk
    }

    // Build tEXt chunk: key\0value
    const textStr = key + '\u0000' + value;
    const textBytes = new TextEncoder().encode(textStr);
    const textChunk = createChunk('tEXt', textBytes);

    // Compose new bytes: bytes[0:offset] + textChunk + bytes[offset:]
    const before = bytes.slice(0, offset);
    const after = bytes.slice(offset);
    const out = new Uint8Array(before.length + textChunk.length + after.length);
    out.set(before, 0);
    out.set(textChunk, before.length);
    out.set(after, before.length + textChunk.length);

    // Convert back to base64 data URL
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < out.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, out.subarray(i, i + chunkSize));
    }
    return 'data:image/png;base64,' + btoa(binary);
}

function readPNGTextChunk(dataURL, key) {
    if (!dataURL.startsWith('data:image/png;base64,')) return null;
    const b64 = dataURL.split(',')[1];
    const byteStr = atob(b64);
    const bytes = new Uint8Array(byteStr.length);
    for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
    const sig = 8; let offset = sig;
    while (offset < bytes.length) {
        const dv = new DataView(bytes.buffer, offset, 8);
        const length = dv.getUint32(0);
        const type = String.fromCharCode(
            bytes[offset+4], bytes[offset+5], bytes[offset+6], bytes[offset+7]
        );
        if (type === 'tEXt') {
            const start = offset + 8;
            const txtBytes = bytes.slice(start, start + length);
            const txt = new TextDecoder().decode(txtBytes);
            const sepIdx = txt.indexOf('\u0000');
            if (sepIdx !== -1) {
                const k = txt.substring(0, sepIdx);
                const v = txt.substring(sepIdx + 1);
                if (k === key) return v;
            }
        }
        if (type === 'IEND') break;
        offset += 8 + length + 4;
    }
    return null;
}
// ---------------------------------------------------------------------

// --- Image Cropper Functions --------------------
function showImageCropper(imageDataURL, mode, fileName) {
    currentCropMode = mode;
    pendingImageFile = fileName;
    
    // Show modal
    cropperModal.style.display = 'flex';
    
    // Prevent body scroll on mobile when modal is open
    document.body.style.overflow = 'hidden';
    
    // Initialize cropper
    if (cropperInstance) {
        cropperInstance.destroy();
    }
    
    // Set image source and wait for load before initializing cropper
    cropperImage.src = imageDataURL;
    
    // Wait for image to be fully loaded before initializing cropper
    cropperImage.onload = () => {
        cropperInstance = new Cropper(cropperImage, {
            aspectRatio: NaN, // Free aspect ratio
            viewMode: 1,
            dragMode: 'move',
            autoCropArea: 1,
            restore: false,
            guides: true,
            center: true,
            highlight: false,
            cropBoxMovable: true,
            cropBoxResizable: true,
            toggleDragModeOnDblclick: false,
            responsive: true,
            background: false,
            checkOrientation: true, // Handle EXIF orientation
            rotatable: true,
            scalable: true,
            zoomable: true,
            zoomOnWheel: true,
            zoomOnTouch: true, // Enable pinch-to-zoom on mobile
            wheelZoomRatio: 0.1,
            ready: function() {
                // Cropper is ready and image is loaded
                console.log('Cropper initialized and ready');
            }
        });
    };
}

function hideImageCropper() {
    cropperModal.style.display = 'none';
    
    // Restore body scroll
    document.body.style.overflow = '';
    
    if (cropperInstance) {
        cropperInstance.destroy();
        cropperInstance = null;
    }
    currentCropMode = null;
    pendingImageFile = null;
}

function applyCroppedImage() {
    if (!cropperInstance) return;
    
    // Get cropped canvas
    const canvas = cropperInstance.getCroppedCanvas({
        maxWidth: 4096,
        maxHeight: 4096,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
    });
    
    if (!canvas) {
        console.error('Failed to get cropped canvas');
        return;
    }
    
    // Convert to data URL
    const croppedDataURL = canvas.toDataURL('image/png');
    
    // Apply based on mode
    if (currentCropMode === 'logo') {
        const img = new Image();
        img.onload = () => {
            selectedLogo = img;
            logoStatus.textContent = `Logo: ${pendingImageFile}`;
            logoStatus.style.color = '#4CAF50';
            
            // Suggest High error correction when logo is added
            suggestErrorCorrectionLevel();
            
            // Regenerate QR code if one exists
            if (currentQRDataURL) {
                saveCurrentState('Added logo');
                // Analytics: Track logo added
                if (typeof gtag !== 'undefined') {
                    gtag('event', 'logo_selected');
                }
                generateQRCode();
            }
        };
        img.src = croppedDataURL;
    } else if (currentCropMode === 'background') {
        const img = new Image();
        img.onload = () => {
            backgroundImage = img;
            bgImageStatus.textContent = `Background: ${pendingImageFile}`;
            bgImageStatus.style.color = '#4CAF50';
            bgPreviewImage.src = croppedDataURL;
            bgPreviewSection.style.display = 'block';
            blendControlsSection.style.display = 'block';
            updateValidationStatus('idle', 'Click "Generate QR Code" to test');

            // Suggest High error correction when background is added
            suggestErrorCorrectionLevel();

            // Analytics: Track background upload
            if (typeof gtag !== 'undefined') {
                gtag('event', 'artistic_background_uploaded');
            }

            if (currentQRDataURL) {
                saveCurrentState('Added artistic background');
                generateQRCode();
            }
        };
        img.src = croppedDataURL;
    }
    
    hideImageCropper();
}
// ---------------------------------------------------------------------

// QR Code Bucket for batch processing with metadata
let qrBucket = [];
const MAX_BUCKET_SIZE_PDF = 8;  // 2 columns × 4 rows
const MAX_BUCKET_SIZE_OTHER = 10;

// Metadata tracking for each QR code
let qrMetadataHistory = [];

// DOM Elements
const textInput = document.getElementById('textInput');
const labelInput = document.getElementById('labelInput');
const clearLabelBtn = document.getElementById('clearLabelBtn');
const logoInput = document.getElementById('logoInput');
const selectLogoBtn = document.getElementById('selectLogoBtn');
const clearLogoBtn = document.getElementById('clearLogoBtn');
const logoStatus = document.getElementById('logoStatus');
const generateBtn = document.getElementById('generateBtn');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const historyPosition = document.getElementById('historyPosition');
const historyDropdownBtn = document.getElementById('historyDropdownBtn');
const historyDropdown = document.getElementById('historyDropdown');
const historyList = document.getElementById('historyList');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const downloadPngBtn = document.getElementById('downloadPngBtn');
const downloadSvgBtn = document.getElementById('downloadSvgBtn');
const downloadJpgBtn = document.getElementById('downloadJpgBtn');
const downloadPdfBtn = document.getElementById('downloadPdfBtn');
const downloadSectionTitle = document.getElementById('downloadSectionTitle');
const clearBtn = document.getElementById('clearBtn');
const qrCanvas = document.getElementById('qrCanvas');
const previewPlaceholder = document.getElementById('previewPlaceholder');

// Bucket elements
const addToBucketBtn = document.getElementById('addToBucketBtn');
const bucketCount = document.getElementById('bucketCount');
const bucketCountBtn = document.getElementById('bucketCountBtn');
const bucketSection = document.getElementById('bucketSection');
const bucketPreview = document.getElementById('bucketPreview');
const clearBucketBtn = document.getElementById('clearBucketBtn');
const downloadBucketPngBtn = document.getElementById('downloadBucketPngBtn');
const downloadBucketJpgBtn = document.getElementById('downloadBucketJpgBtn');
const downloadBucketPdfBtn = document.getElementById('downloadBucketPdfBtn');

// New metadata PDF buttons
const downloadMetadataPdfBtn = document.getElementById('downloadMetadataPdfBtn');
const downloadPrintablePdfBtn = document.getElementById('downloadPrintablePdfBtn');

// QR Notes input
const qrNotesInput = document.getElementById('qrNotesInput');

// Range inputs
const sizeRange = document.getElementById('sizeRange');
const borderRange = document.getElementById('borderRange');
const logoSizeRange = document.getElementById('logoSizeRange');
const labelSizeRange = document.getElementById('labelSizeRange');
const sizeValue = document.getElementById('sizeValue');
const borderValue = document.getElementById('borderValue');
const logoSizeValue = document.getElementById('logoSizeValue');
const labelSizeValue = document.getElementById('labelSizeValue');

// Artistic QR Code elements
const uploadBgBtn = document.getElementById('uploadBgBtn');
const aiBgBtn = document.getElementById('aiBgBtn');
const clearBgBtn = document.getElementById('clearBgBtn');
const uploadBgSection = document.getElementById('uploadBgSection');
const aiBgSection = document.getElementById('aiBgSection');
const bgImageInput = document.getElementById('bgImageInput');
const selectBgImageBtn = document.getElementById('selectBgImageBtn');
const bgImageStatus = document.getElementById('bgImageStatus');
const aiPromptInput = document.getElementById('aiPromptInput');
const generateAiImageBtn = document.getElementById('generateAiImageBtn');
const cancelAiImageBtn = document.getElementById('cancelAiImageBtn');
const tryBackupRendererBtn = document.getElementById('tryBackupRendererBtn');
const aiImageStatus = document.getElementById('aiImageStatus');
const bgPreviewSection = document.getElementById('bgPreviewSection');
const bgPreviewImage = document.getElementById('bgPreviewImage');
const blendControlsSection = document.getElementById('blendControlsSection');
const blendModeSelect = document.getElementById('blendModeSelect');
const bgOpacityRange = document.getElementById('bgOpacityRange');
const qrStrengthRange = document.getElementById('qrStrengthRange');
const bgOpacityValue = document.getElementById('bgOpacityValue');
const qrStrengthValue = document.getElementById('qrStrengthValue');
const validationStatus = document.getElementById('validationStatus');
const validationIndicator = document.getElementById('validationIndicator');

// Prompt Helper elements
const togglePromptHelperBtn = document.getElementById('togglePromptHelperBtn');
const promptHelperContent = document.getElementById('promptHelperContent');
const contextInput = document.getElementById('contextInput');
const generatePromptBtn = document.getElementById('generatePromptBtn');
const retryPromptBtn = document.getElementById('retryPromptBtn');
const promptSuggestions = document.getElementById('promptSuggestions');
const aiModelStatus = document.getElementById('aiModelStatus');

if (aiModelStatus) {
    aiModelStatus.textContent = `AI model: ${workingGeminiModel}`;
}

// Place ID Search elements (Google Review mode)
const placeIdPanel = document.getElementById('placeIdPanel');
const placeSearchInput = document.getElementById('placeSearchInput');
const placeSearchBtn = document.getElementById('placeSearchBtn');
const placeSearchStatus = document.getElementById('placeSearchStatus');
const placeSearchResults = document.getElementById('placeSearchResults');

// Color inputs
const darkColorPicker = document.getElementById('darkColorPicker');
const lightColorPicker = document.getElementById('lightColorPicker');
const darkColorText = document.getElementById('darkColorText');
const lightColorText = document.getElementById('lightColorText');
const labelColorPicker = document.getElementById('labelColorPicker');
const labelColorText = document.getElementById('labelColorText');
const colorPresets = document.querySelectorAll('.color-preset');
const styleBtns = document.querySelectorAll('.style-btn');
const errorCorrectionLevel = document.getElementById('errorCorrectionLevel');
const qrModeRadios = document.querySelectorAll('input[name="qrMode"]');

// Quick template buttons
const templateBtns = document.querySelectorAll('.template-btn');

// Cropper modal elements
const cropperModal = document.getElementById('cropperModal');
const cropperImage = document.getElementById('cropperImage');
const cropperCancel = document.getElementById('cropperCancel');
const cropperApply = document.getElementById('cropperApply');
const cropperRotateLeft = document.getElementById('cropperRotateLeft');
const cropperRotateRight = document.getElementById('cropperRotateRight');
const cropperFlipH = document.getElementById('cropperFlipH');
const cropperFlipV = document.getElementById('cropperFlipV');
const cropperReset = document.getElementById('cropperReset');

// Cropper instance and state
let cropperInstance = null;
let currentCropMode = null; // 'logo' or 'background'
let pendingImageFile = null;

// Cropper control event listeners
cropperCancel.addEventListener('click', () => {
    hideImageCropper();
});

cropperApply.addEventListener('click', () => {
    applyCroppedImage();
});

cropperRotateLeft.addEventListener('click', () => {
    if (cropperInstance) {
        cropperInstance.rotate(-90);
    }
});

cropperRotateRight.addEventListener('click', () => {
    if (cropperInstance) {
        cropperInstance.rotate(90);
    }
});

cropperFlipH.addEventListener('click', () => {
    if (cropperInstance) {
        const data = cropperInstance.getData();
        cropperInstance.scaleX(data.scaleX === 1 ? -1 : 1);
    }
});

cropperFlipV.addEventListener('click', () => {
    if (cropperInstance) {
        const data = cropperInstance.getData();
        cropperInstance.scaleY(data.scaleY === 1 ? -1 : 1);
    }
});

cropperReset.addEventListener('click', () => {
    if (cropperInstance) {
        cropperInstance.reset();
    }
});

// Close modal when clicking on background
cropperModal.addEventListener('click', (e) => {
    if (e.target === cropperModal) {
        hideImageCropper();
    }
});

templateBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const template = btn.dataset.template;
        let templateText = '';
        
        // Toggle filter state
        btn.classList.toggle('active-filter');
        
        // Filter use cases based on active filters
        filterUseCases();
        
        if (placeIdPanel) placeIdPanel.style.display = 'none';
        
        switch(template) {
            case 'google-review':
                templateText = 'https://search.google.com/local/writereview?placeid=your place id';
                labelInput.value = 'Leave us a Google Review!';
                isGoogleReviewMode = true;
                document.getElementById('googleColorToggle').style.display = 'block';
                if (placeIdPanel) {
                    placeIdPanel.style.display = 'block';
                    const hint = document.getElementById('placeApiKeyHint');
                    if (hint) hint.style.display = GOOGLE_MAPS_API_KEY ? 'none' : 'block';
                }
                break;
            case 'url':
                templateText = 'https://';
                isGoogleReviewMode = false;
                document.getElementById('googleColorToggle').style.display = 'none';
                break;
            case 'email':
                templateText = 'mailto:your@email.com';
                isGoogleReviewMode = false;
                document.getElementById('googleColorToggle').style.display = 'none';
                break;
            case 'phone':
                templateText = 'tel:+1234567890';
                isGoogleReviewMode = false;
                document.getElementById('googleColorToggle').style.display = 'none';
                break;
            case 'sms':
                templateText = 'sms:+1234567890?body=Your message here';
                isGoogleReviewMode = false;
                document.getElementById('googleColorToggle').style.display = 'none';
                break;
            case 'wifi':
                templateText = 'WIFI:T:WPA;S:NetworkName;P:Password;;';
                isGoogleReviewMode = false;
                document.getElementById('googleColorToggle').style.display = 'none';
                break;
            case 'vcard':
                templateText = 'BEGIN:VCARD\nVERSION:3.0\nFN:Full Name\nTEL:+1234567890\nEMAIL:email@example.com\nORG:Company Name\nTITLE:Job Title\nEND:VCARD';
                isGoogleReviewMode = false;
                document.getElementById('googleColorToggle').style.display = 'none';
                break;
            case 'mecard':
                templateText = 'MECARD:N:Last Name,First Name;TEL:+1234567890;EMAIL:email@example.com;URL:https://example.com;;';
                isGoogleReviewMode = false;
                document.getElementById('googleColorToggle').style.display = 'none';
                break;
            case 'event':
                templateText = 'BEGIN:VEVENT\nSUMMARY:Event Title\nDTSTART:20250115T100000Z\nDTEND:20250115T110000Z\nLOCATION:Event Location\nDESCRIPTION:Event description here\nEND:VEVENT';
                isGoogleReviewMode = false;
                document.getElementById('googleColorToggle').style.display = 'none';
                break;
            case 'geo':
                templateText = 'geo:37.7749,-122.4194,100';
                isGoogleReviewMode = false;
                document.getElementById('googleColorToggle').style.display = 'none';
                break;
        }
        
        textInput.value = templateText;
        textInput.focus();
        
        // Analytics: Track template selection
        if (typeof gtag !== 'undefined') {
            gtag('event', 'input_template_selected', {
                'template': template
            });
        }
        
        // Select the template text for easy editing
        if (template === 'url') {
            textInput.setSelectionRange(8, 8); // Place cursor after https://
        } else if (template === 'google-review') {
            // Select 'your place id' for easy replacement
            const startPos = templateText.indexOf('your place id');
            textInput.setSelectionRange(startPos, startPos + 13);
        } else {
            textInput.select();
        }
    });
});

// ===== USE CASE EXAMPLES SECTION =====

// Use case examples data
const useCaseExamples = [
    // Google Review examples
    {
        type: 'google-review',
        icon: '⭐',
        title: 'Restaurant Review',
        description: 'Table tent or receipt QR for customer feedback',
        content: 'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4',
        label: 'Love your meal? Leave us a review!'
    },
    {
        type: 'google-review',
        icon: '🏥',
        title: 'Medical Office Review',
        description: 'Reception desk QR for patient reviews',
        content: 'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4',
        label: 'Share your experience'
    },
    {
        type: 'google-review',
        icon: '🏪',
        title: 'Retail Store Review',
        description: 'Point of sale QR for customer feedback',
        content: 'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4',
        label: 'Rate your shopping experience'
    },
    
    // URL examples
    {
        type: 'url',
        icon: '🌐',
        title: 'Website Link',
        description: 'Business card or flyer link to website',
        content: 'https://www.yourcompany.com',
        label: 'Visit our website'
    },
    {
        type: 'url',
        icon: '📱',
        title: 'Social Media Profile',
        description: 'Instagram/Facebook/LinkedIn profile link',
        content: 'https://www.instagram.com/yourcompany',
        label: 'Follow us on Instagram'
    },
    {
        type: 'url',
        icon: '🍽️',
        title: 'Restaurant Menu',
        description: 'Link to online menu or ordering',
        content: 'https://www.yourrestaurant.com/menu',
        label: 'View Our Menu'
    },
    {
        type: 'url',
        icon: '📄',
        title: 'Product Manual',
        description: 'Link to PDF manual or documentation',
        content: 'https://www.yourcompany.com/manual.pdf',
        label: 'View Product Manual'
    },
    {
        type: 'url',
        icon: '🎥',
        title: 'Video Tutorial',
        description: 'YouTube or video hosting link',
        content: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        label: 'Watch Tutorial'
    },
    
    // Email examples - General
    {
        type: 'email',
        icon: '📧',
        title: 'Contact Email',
        description: 'Business card email link',
        content: 'mailto:contact@yourcompany.com',
        label: 'Email us'
    },
    {
        type: 'email',
        icon: '💼',
        title: 'Sales Inquiry',
        description: 'Pre-filled subject for sales questions',
        content: 'mailto:sales@yourcompany.com?subject=Product%20Inquiry',
        label: 'Contact Sales'
    },
    {
        type: 'email',
        icon: '🛠️',
        title: 'Support Request',
        description: 'Pre-filled support email',
        content: 'mailto:support@yourcompany.com?subject=Support%20Request&body=Please%20describe%20your%20issue',
        label: 'Get Support'
    },
    
    // Email examples - Restaurant specific
    {
        type: 'email',
        icon: '🍴',
        title: 'Restaurant Reservations',
        description: 'Email for table bookings',
        content: 'mailto:reservations@restaurant.com?subject=Table%20Reservation%20Request',
        label: 'Email for Reservations'
    },
    {
        type: 'email',
        icon: '🎉',
        title: 'Catering Inquiry',
        description: 'Request catering services',
        content: 'mailto:catering@restaurant.com?subject=Catering%20Request',
        label: 'Catering Services'
    },
    {
        type: 'email',
        icon: '👨‍🍳',
        title: 'Chef Feedback',
        description: 'Direct line to chef or manager',
        content: 'mailto:chef@restaurant.com?subject=Compliments%20and%20Suggestions',
        label: 'Message the Chef'
    },
    
    // Email examples - Event specific
    {
        type: 'email',
        icon: '🎫',
        title: 'Event Inquiries',
        description: 'Questions about event details',
        content: 'mailto:info@events.com?subject=Event%20Question',
        label: 'Ask About Event'
    },
    {
        type: 'email',
        icon: '🎤',
        title: 'Speaker Contact',
        description: 'Contact event speaker or organizer',
        content: 'mailto:speaker@conference.com?subject=Speaker%20Inquiry',
        label: 'Contact Speaker'
    },
    {
        type: 'email',
        icon: '📋',
        title: 'RSVP via Email',
        description: 'Email RSVP for event',
        content: 'mailto:rsvp@party.com?subject=RSVP%20for%20Event&body=Number%20of%20guests:',
        label: 'RSVP Now'
    },
    
    // Phone examples - General
    {
        type: 'phone',
        icon: '📞',
        title: 'Business Phone',
        description: 'One-tap call to business number',
        content: 'tel:+15555551234',
        label: 'Call us'
    },
    {
        type: 'phone',
        icon: '🚑',
        title: 'Emergency Contact',
        description: 'Quick dial emergency number',
        content: 'tel:+15555559999',
        label: 'Emergency Line'
    },
    
    // Phone examples - Restaurant specific
    {
        type: 'phone',
        icon: '🍕',
        title: 'Restaurant Takeout',
        description: 'Call to place takeout order',
        content: 'tel:+15555551234',
        label: 'Call for Takeout'
    },
    {
        type: 'phone',
        icon: '🪑',
        title: 'Reservation Hotline',
        description: 'Call to book a table',
        content: 'tel:+15555555678',
        label: 'Call to Reserve'
    },
    {
        type: 'phone',
        icon: '🚗',
        title: 'Delivery Hotline',
        description: 'Order delivery by phone',
        content: 'tel:+15555559876',
        label: 'Call for Delivery'
    },
    
    // Phone examples - Event specific
    {
        type: 'phone',
        icon: '🎟️',
        title: 'Event Box Office',
        description: 'Call for tickets or information',
        content: 'tel:+15555556789',
        label: 'Call Box Office'
    },
    {
        type: 'phone',
        icon: '🎪',
        title: 'Event Coordinator',
        description: 'Speak with event planner',
        content: 'tel:+15555557890',
        label: 'Contact Coordinator'
    },
    
    // SMS examples
    {
        type: 'sms',
        icon: '💬',
        title: 'Text to Join',
        description: 'SMS opt-in for marketing',
        content: 'sms:+15555551234?body=JOIN',
        label: 'Text JOIN to subscribe'
    },
    {
        type: 'sms',
        icon: '📲',
        title: 'Reservation Request',
        description: 'Pre-filled text for reservations',
        content: 'sms:+15555551234?body=I\'d%20like%20to%20make%20a%20reservation%20for',
        label: 'Text to reserve'
    },
    
    // WiFi examples
    {
        type: 'wifi',
        icon: '📶',
        title: 'Guest WiFi',
        description: 'Restaurant or office guest network',
        content: 'WIFI:T:WPA;S:GuestNetwork;P:Welcome123;;',
        label: 'Connect to WiFi'
    },
    {
        type: 'wifi',
        icon: '🏨',
        title: 'Hotel WiFi',
        description: 'Room card or information sheet',
        content: 'WIFI:T:WPA;S:HotelWiFi;P:SecurePass456;;',
        label: 'Hotel WiFi Access'
    },
    
    // vCard examples
    {
        type: 'vcard',
        icon: '👤',
        title: 'Business Card',
        description: 'Save contact info to phone',
        content: 'BEGIN:VCARD\nVERSION:3.0\nFN:John Smith\nTEL:+15555551234\nEMAIL:john@company.com\nORG:Acme Corp\nTITLE:Sales Director\nEND:VCARD',
        label: 'Save Contact'
    },
    {
        type: 'vcard',
        icon: '💼',
        title: 'Team Member Card',
        description: 'Employee directory or trade show',
        content: 'BEGIN:VCARD\nVERSION:3.0\nFN:Jane Doe\nTEL:+15555555678\nEMAIL:jane@company.com\nORG:Acme Corp\nTITLE:Marketing Manager\nURL:https://linkedin.com/in/janedoe\nEND:VCARD',
        label: 'Connect with me'
    },
    
    // MECARD examples
    {
        type: 'mecard',
        icon: '📇',
        title: 'Simple Contact',
        description: 'Compact contact format (Japanese)',
        content: 'MECARD:N:Tanaka,Yuki;TEL:+81901234567;EMAIL:yuki@example.jp;URL:https://example.jp;;',
        label: 'Add Contact'
    },
    
    // Event examples
    {
        type: 'event',
        icon: '📅',
        title: 'Conference Event',
        description: 'Add event to calendar',
        content: 'BEGIN:VEVENT\nSUMMARY:Tech Conference 2026\nDTSTART:20260315T090000Z\nDTEND:20260315T170000Z\nLOCATION:Convention Center\nDESCRIPTION:Annual technology conference\nEND:VEVENT',
        label: 'Add to Calendar'
    },
    {
        type: 'event',
        icon: '🎉',
        title: 'Party Invitation',
        description: 'Event invitation with details',
        content: 'BEGIN:VEVENT\nSUMMARY:Office Holiday Party\nDTSTART:20261220T180000Z\nDTEND:20261220T220000Z\nLOCATION:Downtown Plaza\nDESCRIPTION:Join us for our annual celebration!\nEND:VEVENT',
        label: 'Save the Date'
    },
    {
        type: 'event',
        icon: '🏃',
        title: 'Fitness Class',
        description: 'Recurring class schedule',
        content: 'BEGIN:VEVENT\nSUMMARY:Yoga Class\nDTSTART:20260310T180000Z\nDTEND:20260310T190000Z\nLOCATION:Studio B\nDESCRIPTION:Beginner-friendly yoga session\nEND:VEVENT',
        label: 'Join Class'
    },
    {
        type: 'event',
        icon: '🎭',
        title: 'Theater Show',
        description: 'Add show to calendar',
        content: 'BEGIN:VEVENT\nSUMMARY:Broadway Musical\nDTSTART:20260420T193000Z\nDTEND:20260420T223000Z\nLOCATION:Main Theater\nDESCRIPTION:Evening performance\nEND:VEVENT',
        label: 'Save Show Date'
    },
    {
        type: 'event',
        icon: '🎓',
        title: 'Webinar/Workshop',
        description: 'Online event invitation',
        content: 'BEGIN:VEVENT\nSUMMARY:Marketing Webinar\nDTSTART:20260510T140000Z\nDTEND:20260510T150000Z\nLOCATION:Zoom Meeting\nDESCRIPTION:Learn digital marketing strategies\nEND:VEVENT',
        label: 'Register for Webinar'
    },
    
    // Location examples - General
    {
        type: 'geo',
        icon: '📍',
        title: 'Store Location',
        description: 'Open maps to business address',
        content: 'geo:37.7749,-122.4194',
        label: 'Get Directions'
    },
    {
        type: 'geo',
        icon: '🅿️',
        title: 'Parking Location',
        description: 'Find parking garage or lot',
        content: 'geo:40.7128,-74.0060',
        label: 'Find Parking'
    },
    {
        type: 'geo',
        icon: '🏛️',
        title: 'Tourist Attraction',
        description: 'Navigate to landmark or attraction',
        content: 'geo:48.8584,2.2945,100',
        label: 'Visit Eiffel Tower'
    },
    
    // Location examples - Restaurant specific
    {
        type: 'geo',
        icon: '🍔',
        title: 'Restaurant Location',
        description: 'Navigate to restaurant',
        content: 'geo:34.0522,-118.2437',
        label: 'Get Directions to Restaurant'
    },
    {
        type: 'geo',
        icon: '🚪',
        title: 'Back Entrance',
        description: 'Delivery or special entrance',
        content: 'geo:34.0523,-118.2438',
        label: 'Delivery Entrance'
    },
    
    // Location examples - Event specific
    {
        type: 'geo',
        icon: '🎪',
        title: 'Event Venue',
        description: 'Navigate to event location',
        content: 'geo:40.7580,-73.9855',
        label: 'Get Directions to Venue'
    },
    {
        type: 'geo',
        icon: '🚗',
        title: 'Event Parking',
        description: 'Designated parking for event',
        content: 'geo:40.7582,-73.9857',
        label: 'Event Parking Location'
    },
    
    // Location examples - Hotel specific
    {
        type: 'geo',
        icon: '🏨',
        title: 'Hotel Location',
        description: 'Navigate to hotel property',
        content: 'geo:36.1147,-115.1728',
        label: 'Directions to Hotel'
    },
    {
        type: 'geo',
        icon: '🏊',
        title: 'Hotel Amenity Location',
        description: 'Pool, spa, or fitness center',
        content: 'geo:36.1148,-115.1729',
        label: 'Find Pool & Spa'
    },
    {
        type: 'geo',
        icon: '🎡',
        title: 'Nearby Attractions',
        description: 'Local points of interest',
        content: 'geo:36.1150,-115.1730',
        label: 'Explore Nearby'
    },
    
    // Location examples - Business specific
    {
        type: 'geo',
        icon: '🏢',
        title: 'Office Location',
        description: 'Navigate to business address',
        content: 'geo:37.7833,-122.4167',
        label: 'Get Directions to Office'
    },
    {
        type: 'geo',
        icon: '🚪',
        title: 'Meeting Room Entrance',
        description: 'Conference room or suite location',
        content: 'geo:37.7834,-122.4168',
        label: 'Conference Room C'
    },
    
    // Google Review examples - Hotel specific
    {
        type: 'google-review',
        icon: '🛏️',
        title: 'Hotel Stay Review',
        description: 'Room card or checkout QR for reviews',
        content: 'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4',
        label: 'Enjoyed your stay? Leave a review!'
    },
    
    // Google Review examples - Business specific
    {
        type: 'google-review',
        icon: '💼',
        title: 'Professional Service Review',
        description: 'Law office, accounting, consulting',
        content: 'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4',
        label: 'Share your experience'
    },
    {
        type: 'google-review',
        icon: '🏪',
        title: 'Business Location Review',
        description: 'Office, shop, or service location',
        content: 'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4',
        label: 'Rate your visit'
    },
    
    // Phone examples - Hotel specific
    {
        type: 'phone',
        icon: '🏨',
        title: 'Hotel Front Desk',
        description: 'Call reception or concierge',
        content: 'tel:+15555551234',
        label: 'Contact Front Desk'
    },
    {
        type: 'phone',
        icon: '🛎️',
        title: 'Room Service',
        description: 'Order food or amenities',
        content: 'tel:+15555555555',
        label: 'Call Room Service'
    },
    {
        type: 'phone',
        icon: '🅿️',
        title: 'Valet Service',
        description: 'Request vehicle or assistance',
        content: 'tel:+15555556666',
        label: 'Call Valet'
    },
    
    // Phone examples - Business specific
    {
        type: 'phone',
        icon: '📞',
        title: 'Main Office Line',
        description: 'Primary business contact',
        content: 'tel:+15555551111',
        label: 'Call Main Office'
    },
    {
        type: 'phone',
        icon: '💼',
        title: 'Sales Department',
        description: 'Dedicated sales inquiry line',
        content: 'tel:+15555552222',
        label: 'Contact Sales'
    },
    {
        type: 'phone',
        icon: '📅',
        title: 'Appointment Scheduling',
        description: 'Book consultation or meeting',
        content: 'tel:+15555553333',
        label: 'Schedule Appointment'
    },
    
    // URL examples - Hotel specific
    {
        type: 'url',
        icon: '🛏️',
        title: 'Room Booking',
        description: 'Direct booking link (no commission!)',
        content: 'https://www.yourhotel.com/book-now',
        label: 'Book Your Stay'
    },
    {
        type: 'url',
        icon: '🍽️',
        title: 'Hotel Restaurant Menu',
        description: 'In-room dining or restaurant menu',
        content: 'https://www.yourhotel.com/dining',
        label: 'View Dining Menu'
    },
    {
        type: 'url',
        icon: '🎯',
        title: 'Guest Services Guide',
        description: 'Amenities, activities, local attractions',
        content: 'https://www.yourhotel.com/guest-services',
        label: 'Explore Guest Services'
    }
];


// Toggle use cases section
function toggleUseCases() {
    const container = document.getElementById('use-cases-container');
    const icon = document.getElementById('use-cases-toggle-icon');
    
    if (container.style.display === 'none') {
        container.style.display = 'block';
        icon.classList.add('expanded');
        renderUseCases(); // Render on first open
    } else {
        container.style.display = 'none';
        icon.classList.remove('expanded');
    }
}

// Toggle artistic controls section
function toggleArtisticControls() {
    const content = document.getElementById('artisticControlsContent');
    const icon = document.getElementById('artistic-toggle-icon');
    
    if (content.style.display === 'none') {
        content.style.display = 'block';
        icon.classList.add('expanded');
    } else {
        content.style.display = 'none';
        icon.classList.remove('expanded');
    }
}

// Render use case cards
function renderUseCases() {
    const grid = document.getElementById('use-case-grid');
    const noExamplesMsg = document.getElementById('no-examples-message');
    
    // Get active filters
    const activeFilters = Array.from(document.querySelectorAll('.template-btn.active-filter'))
        .map(btn => btn.dataset.template);
    
    // If no filters selected, show nothing (blank state)
    if (activeFilters.length === 0) {
        grid.innerHTML = '';
        noExamplesMsg.style.display = 'none';
        return;
    }
    
    // Filter examples by selected templates
    const filteredExamples = useCaseExamples.filter(example => 
        activeFilters.includes(example.type)
    );
    
    // Show/hide no examples message
    if (filteredExamples.length === 0) {
        grid.innerHTML = '';
        noExamplesMsg.style.display = 'block';
        return;
    } else {
        noExamplesMsg.style.display = 'none';
    }
    
    // Render cards
    grid.innerHTML = filteredExamples.map(example => `
        <div class="use-case-card" onclick="applyUseCase('${example.type}', '${escapeHtml(example.content)}', '${escapeHtml(example.label)}')">
            <div class="use-case-icon">${example.icon}</div>
            <div class="use-case-title">${example.title}</div>
            <div class="use-case-description">${example.description}</div>
            <div class="use-case-preview">${example.content.substring(0, 50)}${example.content.length > 50 ? '...' : ''}</div>
        </div>
    `).join('');
}

// Filter use cases based on active template filters
function filterUseCases() {
    const container = document.getElementById('use-cases-container');
    if (container.style.display !== 'none') {
        renderUseCases();
    }
}

// Apply use case to form
function applyUseCase(type, content, label) {
    textInput.value = unescapeHtml(content);
    labelInput.value = unescapeHtml(label);
    
    // Handle Google review specific settings
    if (type === 'google-review') {
        isGoogleReviewMode = true;
        document.getElementById('googleColorToggle').style.display = 'block';
    } else {
        isGoogleReviewMode = false;
        document.getElementById('googleColorToggle').style.display = 'none';
    }
    
    // Flash the textarea to show it changed
    textInput.style.background = '#e7f3ff';
    setTimeout(() => {
        textInput.style.background = '';
    }, 500);
    
    // Focus the textarea
    textInput.focus();
    
    // Analytics
    if (typeof gtag !== 'undefined') {
        gtag('event', 'use_case_applied', {
            'use_case_type': type
        });
    }
}

// HTML escape/unescape helpers
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function unescapeHtml(text) {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'");
}

// Color preset buttons
colorPresets.forEach(btn => {
    btn.addEventListener('click', () => {
        const darkColor = btn.dataset.dark;
        const lightColor = btn.dataset.light;
        
        darkColorPicker.value = darkColor;
        lightColorPicker.value = lightColor;
        darkColorText.value = darkColor;
        lightColorText.value = lightColor;
        currentDarkColor = darkColor;
        currentLightColor = lightColor;
        
        // Update active state
        colorPresets.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Track color preset selection
        if (typeof gtag !== 'undefined') {
            gtag('event', 'colors_preset_selected', {
                'dark_color': darkColor,
                'light_color': lightColor
            });
        }
    });
});

// Set first preset as active
colorPresets[0].classList.add('active');

// Color picker sync
darkColorPicker.addEventListener('input', (e) => {
    const color = e.target.value;
    darkColorText.value = color;
    currentDarkColor = color;
    colorPresets.forEach(b => b.classList.remove('active'));
    // Analytics: Track dark color changed via picker
    if (typeof gtag !== 'undefined') {
        gtag('event', 'colors_dark_changed', {
            'method': 'picker',
            'value': color
        });
    }
    if (currentQRDataURL) {
        saveCurrentState('Changed dark color');
        generateQRCode();
    }
});

lightColorPicker.addEventListener('input', (e) => {
    const color = e.target.value;
    lightColorText.value = color;
    currentLightColor = color;
    colorPresets.forEach(b => b.classList.remove('active'));
    // Analytics: Track light color changed via picker
    if (typeof gtag !== 'undefined') {
        gtag('event', 'colors_light_changed', {
            'method': 'picker',
            'value': color
        });
    }
    if (currentQRDataURL) {
        saveCurrentState('Changed light color');
        generateQRCode();
    }
});

darkColorText.addEventListener('input', (e) => {
    let color = e.target.value;
    if (/^#[0-9A-F]{6}$/i.test(color)) {
        darkColorPicker.value = color;
        currentDarkColor = color;
        colorPresets.forEach(b => b.classList.remove('active'));
        // Analytics: Track dark color changed via text input
        if (typeof gtag !== 'undefined') {
            gtag('event', 'colors_dark_changed', {
                'method': 'text_input',
                'value': color
            });
        }
        if (currentQRDataURL) {
            saveCurrentState('Changed dark color');
            generateQRCode();
        }
    }
});

lightColorText.addEventListener('input', (e) => {
    let color = e.target.value;
    if (/^#[0-9A-F]{6}$/i.test(color)) {
        lightColorPicker.value = color;
        currentLightColor = color;
        colorPresets.forEach(b => b.classList.remove('active'));
        // Analytics: Track light color changed via text input
        if (typeof gtag !== 'undefined') {
            gtag('event', 'colors_light_changed', {
                'method': 'text_input',
                'value': color
            });
        }
        if (currentQRDataURL) {
            saveCurrentState('Changed light color');
            generateQRCode();
        }
    }
});

labelColorPicker.addEventListener('input', (e) => {
    const color = e.target.value;
    labelColorText.value = color;
    currentLabelColor = color;
    // Analytics: Track label color changed via picker
    if (typeof gtag !== 'undefined') {
        gtag('event', 'colors_label_changed', {
            'method': 'picker',
            'value': color
        });
    }
    if (currentQRDataURL) {
        saveCurrentState('Changed label color');
        generateQRCode();
    }
});

labelColorText.addEventListener('input', (e) => {
    let color = e.target.value;
    if (/^#[0-9A-F]{6}$/i.test(color)) {
        labelColorPicker.value = color;
        currentLabelColor = color;
        // Analytics: Track label color changed via text input
        if (typeof gtag !== 'undefined') {
            gtag('event', 'colors_label_changed', {
                'method': 'text_input',
                'value': color
            });
        }
        if (currentQRDataURL) {
            saveCurrentState('Changed label color');
            generateQRCode();
        }
    }
});

// Google colors checkbox toggle
const useGoogleColorsCheckbox = document.getElementById('useGoogleColors');
if (useGoogleColorsCheckbox) {
    useGoogleColorsCheckbox.addEventListener('change', (e) => {
        useGoogleColorsInLabel = e.target.checked;
        if (currentQRDataURL) {
            generateQRCode();
        }
    });
}

// Style buttons
styleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        currentQRStyle = btn.dataset.style;
        styleBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Track style selection
        if (typeof gtag !== 'undefined') {
            gtag('event', 'style_pattern_selected', {
                'pattern': currentQRStyle
            });
        }
    });
});

// Error Correction Level selector
errorCorrectionLevel.addEventListener('change', (e) => {
    currentErrorCorrectionLevel = e.target.value;
    
    // Track error correction selection
    if (typeof gtag !== 'undefined') {
        gtag('event', 'error_correction_level_changed', {
            'level': currentErrorCorrectionLevel
        });
    }
    
    // Regenerate QR code if one exists
    if (currentQRDataURL) {
        const errorCorrectionLabels = { 'L': 'Low', 'M': 'Medium', 'Q': 'Quality', 'H': 'High' };
        saveCurrentState(`Changed error correction to ${errorCorrectionLabels[e.target.value]}`);
        generateQRCode();
    }
});

// QR Mode selector (Standard vs Artistic)
qrModeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
        const selectedMode = e.target.value;
        const artisticControls = document.getElementById('artisticControls');
        
        // Show/hide artistic controls based on mode
        if (selectedMode === 'artistic') {
            artisticControls.style.display = 'block';
        } else {
            artisticControls.style.display = 'none';
        }
        
        // Track mode selection
        if (typeof gtag !== 'undefined') {
            gtag('event', 'qr_mode_changed', {
                'mode': selectedMode
            });
        }
        
        // Regenerate QR code if one exists
        if (currentQRDataURL) {
            const modeLabels = { 'standard': 'Standard', 'artistic': 'Artistic' };
            saveCurrentState(`Changed mode to ${modeLabels[selectedMode]}`);
            generateQRCode();
        }
    });
});

// Helper function to auto-suggest error correction level based on logo presence
function suggestErrorCorrectionLevel() {
    // Only auto-suggest if user hasn't explicitly changed from High
    if (currentErrorCorrectionLevel === 'H') {
        if (selectedLogo || backgroundImage) {
            // Keep High for logos and backgrounds
            if (errorCorrectionLevel.value !== 'H') {
                errorCorrectionLevel.value = 'H';
                currentErrorCorrectionLevel = 'H';
            }
        }
    }
}

// Convert hex color to RGB
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

// Helper function to draw text with Google-colored "Google" word only
function drawGoogleColoredText(ctx, text, x, y, maxWidth) {
    const googleColors = ['#4285F4', '#EA4335', '#FBBC05', '#4285F4', '#34A853', '#EA4335'];
    const words = text.split(' ');
    let line = '';
    let lines = [];
    
    // First, determine all lines (for word wrapping)
    for (let i = 0; i < words.length; i++) {
        const testLine = line + words[i] + ' ';
        const metrics = ctx.measureText(testLine);
        
        if (metrics.width > maxWidth && i > 0) {
            lines.push(line.trim());
            line = words[i] + ' ';
        } else {
            line = testLine;
        }
    }
    lines.push(line.trim());
    
    // Set text alignment to left for precise positioning
    ctx.textAlign = 'left';
    
    // Now draw each line, colorizing only the word "Google"
    let currentY = y;
    const fontSize = parseInt(ctx.font);
    
    for (const lineText of lines) {
        const lineWidth = ctx.measureText(lineText).width;
        const startX = x - (lineWidth / 2); // Center the line
        
        // Check if this line contains "Google"
        const googleIndex = lineText.indexOf('Google');
        
        if (googleIndex !== -1) {
            // Draw text before "Google"
            const textBefore = lineText.substring(0, googleIndex);
            ctx.fillStyle = currentLabelColor;
            ctx.fillText(textBefore, startX, currentY);
            
            // Draw "Google" with character-by-character coloring
            const googleStartX = startX + ctx.measureText(textBefore).width;
            const googleWord = 'Google';
            for (let charIdx = 0; charIdx < googleWord.length; charIdx++) {
                const char = googleWord[charIdx];
                ctx.fillStyle = googleColors[charIdx % googleColors.length];
                const charX = googleStartX + (charIdx > 0 ? ctx.measureText(googleWord.substring(0, charIdx)).width : 0);
                ctx.fillText(char, charX, currentY);
            }
            
            // Draw text after "Google"
            const textAfter = lineText.substring(googleIndex + 6); // 6 = length of "Google"
            ctx.fillStyle = currentLabelColor;
            const afterStartX = googleStartX + ctx.measureText(googleWord).width;
            ctx.fillText(textAfter, afterStartX, currentY);
        } else {
            // No "Google" in this line, draw normally
            ctx.fillStyle = currentLabelColor;
            ctx.fillText(lineText, startX, currentY);
        }
        
        currentY += fontSize * 1.2;
    }
}

// ===== STATE HISTORY MANAGEMENT =====

// Save current state to history
function saveCurrentState(actionLabel = 'Change') {
    if (isRestoringState) return; // Skip during undo/redo
    
    try {
        const state = {
            timestamp: Date.now(),
            label: actionLabel,
            text: textInput.value,
            colors: {
                dark: currentDarkColor,
                light: currentLightColor,
                label: currentLabelColor
            },
            size: parseInt(sizeRange.value),
            logoSize: parseInt(logoSizeRange.value),
            labelSize: parseInt(labelSizeRange.value),
            style: currentQRStyle,
            errorCorrection: currentErrorCorrectionLevel,
            border: parseInt(borderRange.value),
            labelText: labelInput.value,
            googleReviewMode: isGoogleReviewMode,
            useGoogleColors: useGoogleColorsInLabel,
            logo: selectedLogo ? selectedLogo.src : null,
            background: backgroundImage ? backgroundImage.src : null,
            blendMode: currentBlendMode,
            bgOpacity: currentBgOpacity,
            qrStrength: currentQrStrength
        };
        
        // Truncate history if we're in the middle (user made change after undo)
        if (currentStateIndex < stateHistory.length - 1) {
            stateHistory = stateHistory.slice(0, currentStateIndex + 1);
        }
        
        stateHistory.push(state);
        currentStateIndex++;
        
        // Limit history size with graceful degradation
        if (stateHistory.length > MAX_HISTORY) {
            stateHistory.shift();
            currentStateIndex--;
            showNotification(`History limit reached. Oldest state removed (keeping last ${MAX_HISTORY} changes).`, 'info');
        }
        
        updateUndoRedoButtons();
        saveHistoryToLocalStorage();
        
    } catch (error) {
        console.error('Error saving state:', error);
    }
}

// Restore a specific state from history
function restoreState(state) {
    isRestoringState = true;
    
    try {
        // Restore text input
        textInput.value = state.text;
        
        // Restore colors
        currentDarkColor = state.colors.dark;
        currentLightColor = state.colors.light;
        currentLabelColor = state.colors.label;
        darkColorPicker.value = currentDarkColor;
        lightColorPicker.value = currentLightColor;
        labelColorPicker.value = currentLabelColor;
        darkColorText.value = currentDarkColor;
        lightColorText.value = currentLightColor;
        labelColorText.value = currentLabelColor;
        
        // Restore sizes
        sizeRange.value = state.size;
        sizeValue.textContent = state.size;
        logoSizeRange.value = state.logoSize;
        logoSizeValue.textContent = state.logoSize;
        labelSizeRange.value = state.labelSize;
        labelSizeValue.textContent = state.labelSize;
        
        // Restore style
        currentQRStyle = state.style;
        document.querySelectorAll('.style-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.style === state.style);
        });
        
        // Restore error correction
        currentErrorCorrectionLevel = state.errorCorrection;
        errorCorrectionLevel.value = state.errorCorrection;
        
        // Restore border
        if (state.border !== undefined) {
            borderRange.value = state.border;
            borderValue.textContent = state.border;
        }
        
        // Restore label
        labelInput.value = state.labelText;
        
        // Restore Google Review mode
        isGoogleReviewMode = state.googleReviewMode;
        useGoogleColorsInLabel = state.useGoogleColors;
        const googleColorsCheckbox = document.getElementById('useGoogleColors');
        if (googleColorsCheckbox) {
            googleColorsCheckbox.checked = state.useGoogleColors;
        }
        
        // Restore logo
        if (state.logo) {
            const img = new Image();
            img.onload = () => {
                selectedLogo = img;
                logoStatus.textContent = 'Logo loaded from history';
                clearLogoBtn.style.display = 'inline-block';
                generateQRCode();
            };
            img.src = state.logo;
        } else if (selectedLogo) {
            selectedLogo = null;
            logoStatus.textContent = 'No logo';
            clearLogoBtn.style.display = 'none';
        }
        
        // Restore artistic background
        if (state.background) {
            const img = new Image();
            img.onload = () => {
                backgroundImage = img;
                currentBlendMode = state.blendMode;
                currentBgOpacity = state.bgOpacity;
                currentQrStrength = state.qrStrength;
                
                if (blendModeSelect) blendModeSelect.value = state.blendMode;
                if (bgOpacityRange) {
                    bgOpacityRange.value = state.bgOpacity;
                    bgOpacityValue.textContent = state.bgOpacity;
                }
                if (qrStrengthRange) {
                    qrStrengthRange.value = state.qrStrength;
                    qrStrengthValue.textContent = state.qrStrength;
                }
                
                generateQRCode();
            };
            img.src = state.background;
        } else if (backgroundImage) {
            backgroundImage = null;
            currentBlendMode = 'overlay';
            currentBgOpacity = 50;
            currentQrStrength = 80;
        }
        
        // If no logo or background change, regenerate immediately
        if (!state.logo && !state.background) {
            generateQRCode();
        }
        
        showNotification(`↶ Restored: ${state.label}`, 'success');
        
    } catch (error) {
        console.error('Error restoring state:', error);
        showNotification('Error restoring state', 'error');
    } finally {
        isRestoringState = false;
    }
}

// Undo to previous state
function undo() {
    if (currentStateIndex > 0) {
        currentStateIndex--;
        restoreState(stateHistory[currentStateIndex]);
        updateUndoRedoButtons();
        historyDropdown.classList.add('hidden');
        // Analytics: Track undo action
        if (typeof gtag !== 'undefined') {
            gtag('event', 'history_undo_clicked', {
                'from_position': `${currentStateIndex + 2}/${stateHistory.length}`,
                'to_position': `${currentStateIndex + 1}/${stateHistory.length}`
            });
        }
    }
}

// Redo to next state
function redo() {
    if (currentStateIndex < stateHistory.length - 1) {
        currentStateIndex++;
        restoreState(stateHistory[currentStateIndex]);
        updateUndoRedoButtons();
        historyDropdown.classList.add('hidden');
        // Analytics: Track redo action
        if (typeof gtag !== 'undefined') {
            gtag('event', 'history_redo_clicked', {
                'from_position': `${currentStateIndex}/${stateHistory.length}`,
                'to_position': `${currentStateIndex + 1}/${stateHistory.length}`
            });
        }
    }
}

// Update undo/redo button states and position display
function updateUndoRedoButtons() {
    const canUndo = currentStateIndex > 0;
    const canRedo = currentStateIndex < stateHistory.length - 1;
    
    undoBtn.disabled = !canUndo;
    redoBtn.disabled = !canRedo;
    
    // Update tooltip with current state label
    if (canUndo && currentStateIndex > 0) {
        undoBtn.title = `Undo: ${stateHistory[currentStateIndex - 1].label} (Ctrl+Z)`;
    } else {
        undoBtn.title = 'Undo (Ctrl+Z)';
    }
    
    if (canRedo && currentStateIndex < stateHistory.length - 1) {
        redoBtn.title = `Redo: ${stateHistory[currentStateIndex + 1].label} (Ctrl+Y)`;
    } else {
        redoBtn.title = 'Redo (Ctrl+Y)';
    }
    
    // Update position display
    const position = stateHistory.length > 0 ? currentStateIndex + 1 : 1;
    const total = Math.max(stateHistory.length, 1);
    historyPosition.textContent = `${position}/${total}`;
    
    // Update history dropdown content
    populateHistoryDropdown();
}

// Populate history dropdown with all states
function populateHistoryDropdown() {
    if (!historyList) return;
    
    historyList.innerHTML = '';
    
    if (stateHistory.length === 0) {
        historyList.innerHTML = '<div style="padding: 16px; text-align: center; color: #999;">No history yet</div>';
        if (clearHistoryBtn) {
            clearHistoryBtn.disabled = true;
        }
        return;
    }
    
    // Enable clear button when there's history
    if (clearHistoryBtn) {
        clearHistoryBtn.disabled = false;
    }
    
    // Add items in reverse order (newest first)
    for (let i = stateHistory.length - 1; i >= 0; i--) {
        const state = stateHistory[i];
        const isCurrent = i === currentStateIndex;
        
        const item = document.createElement('div');
        item.className = 'history-item' + (isCurrent ? ' current' : '');
        item.dataset.index = i;
        
        const number = document.createElement('span');
        number.className = 'history-item-number';
        number.textContent = `${i + 1}.`;
        
        const label = document.createElement('span');
        label.className = 'history-item-label';
        label.textContent = isCurrent ? `→ ${state.label}` : state.label;
        
        const time = document.createElement('span');
        time.className = 'history-item-time';
        const date = new Date(state.timestamp);
        time.textContent = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        
        item.appendChild(number);
        item.appendChild(label);
        item.appendChild(time);
        
        // Click handler to jump to this state
        item.addEventListener('click', () => {
            jumpToHistoryState(i);
            historyDropdown.classList.add('hidden');
        });
        
        historyList.appendChild(item);
    }
}

// Jump to a specific history state
function jumpToHistoryState(index) {
    if (index < 0 || index >= stateHistory.length || index === currentStateIndex) {
        return;
    }
    
    const fromPos = currentStateIndex + 1;
    const toPos = index + 1;
    const statesJumped = Math.abs(toPos - fromPos);
    
    currentStateIndex = index;
    restoreState(stateHistory[index]);
    updateUndoRedoButtons();
    
    // Analytics: Track history jump from dropdown
    if (typeof gtag !== 'undefined') {
        gtag('event', 'history_jump_selected', {
            'from_position': `${fromPos}/${stateHistory.length}`,
            'to_position': `${toPos}/${stateHistory.length}`,
            'states_jumped': statesJumped
        });
    }
}

// Save history to localStorage
function saveHistoryToLocalStorage() {
    try {
        const historyData = {
            version: 1,
            timestamp: Date.now(),
            history: stateHistory,
            index: currentStateIndex
        };
        localStorage.setItem('qr_history', JSON.stringify(historyData));
    } catch (error) {
        if (error.name === 'QuotaExceededError') {
            // Storage quota exceeded - remove oldest states
            console.warn('localStorage quota exceeded, removing old states');
            stateHistory = stateHistory.slice(-Math.floor(MAX_HISTORY / 2)); // Keep last 50%
            currentStateIndex = Math.min(currentStateIndex, stateHistory.length - 1);
            showNotification('Storage full. Removed older history to make room.', 'warning');
            saveHistoryToLocalStorage(); // Try again
        } else {
            console.error('Error saving history to localStorage:', error);
        }
    }
}

// Load history from localStorage on page load
function loadHistoryFromLocalStorage() {
    try {
        const data = localStorage.getItem('qr_history');
        if (!data) return;
        
        const historyData = JSON.parse(data);
        
        // Validate data structure
        if (historyData && historyData.version === 1 && Array.isArray(historyData.history)) {
            stateHistory = historyData.history;
            currentStateIndex = historyData.index;
            updateUndoRedoButtons();
            
            if (stateHistory.length > 0) {
                showNotification(`✨ Restored ${stateHistory.length} previous QR code versions`, 'success');
            }
        }
    } catch (error) {
        console.error('Error loading history from localStorage:', error);
        localStorage.removeItem('qr_history'); // Clear corrupted data
    }
}

// Clear all history
function clearHistory() {
    const confirmed = confirm('Are you sure you want to clear all history? This cannot be undone.');
    if (!confirmed) return;
    
    const historyCount = stateHistory.length;
    
    // Clear history arrays and index
    stateHistory = [];
    currentStateIndex = -1;
    
    // Clear localStorage
    try {
        localStorage.removeItem('qr_history');
    } catch (error) {
        console.error('Error clearing history from localStorage:', error);
    }
    
    // Update UI
    updateUndoRedoButtons();
    
    // Close the dropdown
    if (historyDropdown) {
        historyDropdown.classList.add('hidden');
    }
    
    // Show notification
    showNotification(`🗑️ Cleared ${historyCount} history item${historyCount !== 1 ? 's' : ''}`, 'success');
    
    // Analytics: Track history clear
    if (typeof gtag !== 'undefined') {
        gtag('event', 'history_cleared', {
            'items_cleared': historyCount
        });
    }
}

// ===== END STATE HISTORY MANAGEMENT =====

// Contrast validation function
function validateContrast(darkColor, lightColor) {
    // Calculate relative luminance
    const getLuminance = (rgb) => {
        const rsRGB = rgb.r / 255;
        const gsRGB = rgb.g / 255;
        const bsRGB = rgb.b / 255;
        
        const r = rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
        const g = gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
        const b = bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);
        
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    
    const rgb1 = hexToRgb(darkColor);
    const rgb2 = hexToRgb(lightColor);
    
    if (!rgb1 || !rgb2) return { valid: false, ratio: 0 };
    
    const lum1 = getLuminance(rgb1);
    const lum2 = getLuminance(rgb2);
    
    const lighter = Math.max(lum1, lum2);
    const darker = Math.min(lum1, lum2);
    
    const ratio = (lighter + 0.05) / (darker + 0.05);
    
    // WCAG AA requires 4.5:1 for normal text, we'll use 3:1 for QR codes
    return {
        valid: ratio >= 3.0,
        ratio: ratio.toFixed(2)
    };
}

// Update range value displays
sizeRange.addEventListener('input', (e) => {
    sizeValue.textContent = e.target.value;
});

borderRange.addEventListener('input', (e) => {
    borderValue.textContent = e.target.value;
});

logoSizeRange.addEventListener('input', (e) => {
    logoSizeValue.textContent = e.target.value;
});

labelSizeRange.addEventListener('input', (e) => {
    labelSizeValue.textContent = e.target.value;
});

// Regenerate QR code when sliders are released
sizeRange.addEventListener('change', (e) => {
    if (currentQRDataURL) {
        saveCurrentState(`Changed size to ${e.target.value}`);
        // Analytics: Track QR size adjustment
        if (typeof gtag !== 'undefined') {
            gtag('event', 'size_qr_adjusted', {
                'value': parseInt(e.target.value)
            });
        }
        generateQRCode();
    }
});

borderRange.addEventListener('change', (e) => {
    if (currentQRDataURL) {
        saveCurrentState(`Changed border to ${e.target.value}`);
        // Analytics: Track border adjustment
        if (typeof gtag !== 'undefined') {
            gtag('event', 'size_border_adjusted', {
                'value': parseInt(e.target.value)
            });
        }
        generateQRCode();
    }
});

logoSizeRange.addEventListener('change', (e) => {
    if (currentQRDataURL) {
        saveCurrentState(`Changed logo size to ${e.target.value}%`);
        // Analytics: Track logo size adjustment
        if (typeof gtag !== 'undefined') {
            gtag('event', 'size_logo_adjusted', {
                'value': parseInt(e.target.value)
            });
        }
        generateQRCode();
    }
});

labelSizeRange.addEventListener('change', (e) => {
    if (currentQRDataURL) {
        saveCurrentState(`Changed label size to ${e.target.value}%`);
        // Analytics: Track label size adjustment
        if (typeof gtag !== 'undefined') {
            gtag('event', 'size_label_adjusted', {
                'value': parseInt(e.target.value)
            });
        }
        generateQRCode();
    }
});

// Artistic mode controls event listeners
const dotStyleSelect = document.getElementById('dotStyle');
const cornerSquareStyleSelect = document.getElementById('cornerSquareStyle');
const cornerDotStyleSelect = document.getElementById('cornerDotStyle');
const enableGradientCheckbox = document.getElementById('enableGradient');
const gradientRotationRange = document.getElementById('gradientRotation');
const gradientRotationValue = document.getElementById('gradientRotationValue');

if (dotStyleSelect) {
    dotStyleSelect.addEventListener('change', (e) => {
        if (currentQRDataURL) {
            saveCurrentState(`Changed dot style to ${e.target.value}`);
            if (typeof gtag !== 'undefined') {
                gtag('event', 'artistic_dot_style_changed', { 'style': e.target.value });
            }
            generateQRCode();
        }
    });
}

if (cornerSquareStyleSelect) {
    cornerSquareStyleSelect.addEventListener('change', (e) => {
        if (currentQRDataURL) {
            saveCurrentState(`Changed corner square style to ${e.target.value}`);
            if (typeof gtag !== 'undefined') {
                gtag('event', 'artistic_corner_square_changed', { 'style': e.target.value });
            }
            generateQRCode();
        }
    });
}

if (cornerDotStyleSelect) {
    cornerDotStyleSelect.addEventListener('change', (e) => {
        if (currentQRDataURL) {
            saveCurrentState(`Changed corner dot style to ${e.target.value}`);
            if (typeof gtag !== 'undefined') {
                gtag('event', 'artistic_corner_dot_changed', { 'style': e.target.value });
            }
            generateQRCode();
        }
    });
}

if (enableGradientCheckbox) {
    enableGradientCheckbox.addEventListener('change', (e) => {
        const gradientGroup = document.getElementById('gradientRotationGroup');
        if (gradientGroup) {
            gradientGroup.style.display = e.target.checked ? 'block' : 'none';
        }
        if (currentQRDataURL) {
            saveCurrentState(`${e.target.checked ? 'Enabled' : 'Disabled'} gradient`);
            if (typeof gtag !== 'undefined') {
                gtag('event', 'artistic_gradient_toggled', { 'enabled': e.target.checked });
            }
            generateQRCode();
        }
    });
}

if (gradientRotationRange && gradientRotationValue) {
    gradientRotationRange.addEventListener('input', (e) => {
        gradientRotationValue.textContent = e.target.value;
    });
    
    gradientRotationRange.addEventListener('change', (e) => {
        if (currentQRDataURL) {
            saveCurrentState(`Changed gradient rotation to ${e.target.value}°`);
            if (typeof gtag !== 'undefined') {
                gtag('event', 'artistic_gradient_rotation_changed', { 'rotation': parseInt(e.target.value) });
            }
            generateQRCode();
        }
    });
}

// Label input change - regenerate QR code when label is modified
labelInput.addEventListener('input', (e) => {
    if (currentQRDataURL) {
        saveCurrentState('Modified label text');
        // Analytics: Track label addition
        if (typeof gtag !== 'undefined' && e.target.value.length > 0) {
            gtag('event', 'input_label_added', {
                'label_length': e.target.value.length
            });
        }
        generateQRCode();
    }
});

// ============================================
// ARTISTIC QR CODE EVENT LISTENERS
// ============================================

// Background source toggle buttons
uploadBgBtn.addEventListener('click', () => {
    uploadBgBtn.classList.add('active');
    aiBgBtn.classList.remove('active');
    uploadBgSection.style.display = 'block';
    aiBgSection.style.display = 'none';
});

aiBgBtn.addEventListener('click', () => {
    aiBgBtn.classList.add('active');
    uploadBgBtn.classList.remove('active');
    uploadBgSection.style.display = 'none';
    aiBgSection.style.display = 'block';
});

// Clear background
clearBgBtn.addEventListener('click', () => {
    backgroundImage = null;
    bgPreviewSection.style.display = 'none';
    blendControlsSection.style.display = 'none';
    bgImageStatus.textContent = 'No background selected';
    bgImageStatus.style.color = '#666';
    aiImageStatus.textContent = 'Enter a prompt to generate';
    aiImageStatus.style.color = '#666';
    bgImageInput.value = '';
    aiPromptInput.value = '';
    updateValidationStatus('idle', 'Click "Generate QR Code" to test');
    // Analytics: Track background removal
    if (typeof gtag !== 'undefined') {
        gtag('event', 'artistic_background_cleared');
    }
    if (currentQRDataURL) {
        generateQRCode();
    }
});

// Background image upload
selectBgImageBtn.addEventListener('click', () => {
    bgImageInput.click();
});

bgImageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const dataURL = event.target.result;

            // If PNG, attempt to extract embedded QR metadata
            try {
                if (file.type === 'image/png') {
                    const metaStr = readPNGTextChunk(dataURL, 'QR_META');
                    if (metaStr) {
                        try {
                            const meta = JSON.parse(metaStr);
                            if (meta.text) textInput.value = meta.text;
                            if (meta.label) labelInput.value = meta.label;
                            if (meta.blendMode) {
                                currentBlendMode = meta.blendMode;
                                blendModeSelect.value = currentBlendMode;
                            }
                            if (meta.bgOpacity !== undefined) {
                                currentBgOpacity = parseInt(meta.bgOpacity);
                                bgOpacityRange.value = currentBgOpacity;
                                bgOpacityValue.textContent = currentBgOpacity;
                            }
                            if (meta.qrStrength !== undefined) {
                                currentQrStrength = parseInt(meta.qrStrength);
                                qrStrengthRange.value = currentQrStrength;
                                qrStrengthValue.textContent = currentQrStrength;
                            }
                            if (meta.aiBackground) {
                                lastAiBackgroundMeta = meta.aiBackground;
                            }
                            // Also read preserved analytics (separate chunk) if present
                            try {
                                const analyticsStr = readPNGTextChunk(dataURL, 'QR_ANALYTICS');
                                if (analyticsStr) {
                                    const analytics = JSON.parse(analyticsStr);
                                    // Apply preserved analytics to UI for awareness
                                    if (analytics.version) document.getElementById('qrVersion').textContent = analytics.version;
                                    if (analytics.modules) document.getElementById('qrModules').textContent = `${analytics.modules}×${analytics.modules}`;
                                    if (analytics.minSizeMM) document.getElementById('qrMinSize').textContent = `${analytics.minSizeMM}mm (${analytics.minSizeInch}")`;
                                    if (analytics.usedPercent !== undefined) {
                                        const capacityEl = document.getElementById('qrDataCapacity');
                                        capacityEl.textContent = `${analytics.usedPercent}% used`;
                                        capacityEl.className = 'analytics-value';
                                    }
                                    if (analytics.contrastRatio !== undefined) document.getElementById('qrContrast').textContent = `${analytics.contrastRatio}:1`;
                                }
                            } catch (ae) {
                                console.warn('Failed to parse analytics chunk', ae);
                            }
                            showNotification('Embedded QR metadata detected and applied');
                        } catch (ee) {
                            console.warn('Failed to parse embedded QR metadata', ee);
                        }
                    }
                }
            } catch (err) {
                console.warn('Error reading PNG metadata', err);
            }

            // Show cropper instead of directly loading image
            showImageCropper(dataURL, 'background', file.name);
        };
        reader.readAsDataURL(file);
    }
});

// Extract a prominent color from an image (simple average, can be improved)
function extractProminentColor(img) {
    // Use Color Thief to get the dominant color
    try {
        const colorThief = new window.ColorThief();
        // Color Thief requires the image to be loaded and on the same origin or CORS-enabled
        if (img.complete && img.naturalWidth !== 0) {
            const rgb = colorThief.getColor(img);
            return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        }
    } catch (e) {
        console.warn('Color Thief failed, falling back to black', e);
    }
    return '#000000';
}

// AI image generation
generateAiImageBtn.addEventListener('click', async () => {
    const prompt = aiPromptInput.value.trim();
    if (!prompt) {
        aiImageStatus.textContent = 'Please enter a description';
        aiImageStatus.style.color = '#f44336';
        return;
    }

    if (isGeneratingAI) {
        return;
    }

    // Analytics: Track AI image generation request
    if (typeof gtag !== 'undefined') {
        gtag('event', 'artistic_ai_requested', {
            'prompt_length': prompt.length
        });
    }

    generateAIImageWithRetry(prompt, 1);
});

// Cancel AI generation
cancelAiImageBtn.addEventListener('click', () => {
    if (isGeneratingAI) {
        cancelAIGeneration = true;
        isGeneratingAI = false;
        generateAiImageBtn.disabled = false;
        generateAiImageBtn.textContent = 'Render Image';
        cancelAiImageBtn.style.display = 'none';
        tryBackupRendererBtn.style.display = 'none';
        
        aiImageStatus.innerHTML = 'Generation cancelled. <strong>Next steps:</strong> Upload an image or try again later.';
        aiImageStatus.style.color = '#757575';
        console.log('🚫 User cancelled AI generation');
    } else {
        // Cancel backup renderer
        cancelBackupRenderer = true;
        cancelAiImageBtn.style.display = 'none';
        tryBackupRendererBtn.style.display = 'inline-block';
        generateAiImageBtn.disabled = false;
        
        aiImageStatus.innerHTML = 'Backup renderer cancelled.';
        aiImageStatus.style.color = '#757575';
        console.log('🚫 User cancelled backup renderer');
    }
});

// Try Backup Renderer button - allows user to manually switch to Stable Horde
tryBackupRendererBtn.addEventListener('click', async () => {
    if (!aiPromptInput.value.trim()) {
        alert('Please enter a prompt first!');
        return;
    }
    
    const prompt = aiPromptInput.value.trim();
    
    // Disable buttons during generation
    cancelBackupRenderer = false;
    tryBackupRendererBtn.style.display = 'none';
    generateAiImageBtn.disabled = true;
    cancelAiImageBtn.style.display = 'inline-block'; // Show cancel button
    aiImageStatus.textContent = 'Trying backup renderer (may take 30-60 seconds)...';
    aiImageStatus.style.color = '#1565C0';
    
    try {
        const hordeImage = await generateWithStableHorde(prompt);
        
        // Success!
        backgroundImage = hordeImage;
        aiImageStatus.textContent = 'Vision rendered successfully (via backup service)! ✨';
        aiImageStatus.style.color = '#4CAF50';
        
        // Play notification sound
        playNotificationSound();
        
        bgPreviewImage.src = hordeImage.src;
        bgPreviewSection.style.display = 'block';
        blendControlsSection.style.display = 'block';
        updateValidationStatus('idle', 'Click "Generate QR Code" to test');
        
        // Hide the backup button since we already used it
        tryBackupRendererBtn.style.display = 'none';
        cancelAiImageBtn.style.display = 'none';
        generateAiImageBtn.disabled = false;
        cancelBackupRenderer = false;
        
        // Save AI metadata
        lastAiBackgroundMeta = {
            prompt: prompt,
            imageUrl: hordeImage.src,
            generatedAt: Date.now()
        };
        
        // Auto-generate QR and add to bucket
        try {
            generateQRCode();
            setTimeout(() => {
                try { addQRToBucket(); } catch (e) { console.warn('Failed to auto-add to bucket', e); }
            }, 150);
        } catch (e) {
            console.warn('Failed to auto-generate QR after AI background', e);
        }
    } catch (error) {
        console.error('❌ Backup renderer failed:', error);
        
        // Check if it was cancelled by user
        if (cancelBackupRenderer) {
            aiImageStatus.innerHTML = 'Backup renderer cancelled.';
            aiImageStatus.style.color = '#757575';
        } else {
            aiImageStatus.innerHTML = 'Backup renderer unavailable. Please use the "Upload Image" tab or try again later.';
            aiImageStatus.style.color = '#f44336';
        }
        
        tryBackupRendererBtn.style.display = 'inline-block';
        cancelAiImageBtn.style.display = 'none';
        generateAiImageBtn.disabled = false;
        cancelBackupRenderer = false;
    }
});

// Play notification sound when rendering completes
function playNotificationSound() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 800; // 800 Hz tone
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);
        console.log('🔔 Notification sound played');
    } catch (e) {
        console.log('🔇 Could not play notification sound:', e.message);
    }
}

async function generateAIImageWithRetry(prompt, attempt = 1, maxAttempts = 3) {
    isGeneratingAI = true;
    cancelAIGeneration = false;
    generateAiImageBtn.disabled = true;
    cancelAiImageBtn.style.display = 'inline-block';
    tryBackupRendererBtn.style.display = 'none'; // Hide backup button during generation
    generateAiImageBtn.textContent = attempt > 1 ? `Retrying... (${attempt}/${maxAttempts})` : 'Generating...';
    aiImageStatus.textContent = attempt > 1 ? `Attempt ${attempt}/${maxAttempts} - Rendering your vision...` : 'Rendering your vision...';
    aiImageStatus.style.color = '#1565C0';
    
    // Hide progress bar at start
    const progressContainer = document.getElementById('aiProgressContainer');
    if (progressContainer && attempt === 1) {
        progressContainer.style.display = 'none';
        const progressBar = document.getElementById('aiProgressBar');
        if (progressBar) {
            progressBar.style.width = '0%';
        }
    }

    try {
        // Use Pollinations.ai free API (no key required!)
        // Add cache-busting parameter to avoid stale results
        const cacheBuster = Date.now();
        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${cacheBuster}`;
        
        console.log('🎨 Attempting AI image generation...');
        console.log('📝 Prompt:', prompt);
        console.log('🔗 URL:', imageUrl);
        console.log('🔄 Attempt:', attempt, 'of', maxAttempts);
        
        // Set a timeout for the image load
        const loadImageWithTimeout = (url, timeoutMs = 60000) => {
            return new Promise((resolve, reject) => {
                const startTime = Date.now();
                const img = new Image();
                img.crossOrigin = 'anonymous';
                
                const timeoutId = setTimeout(() => {
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                    console.error('⏱️ Timeout after', elapsed, 'seconds');
                    reject(new Error('Image generation timed out after 60 seconds'));
                }, timeoutMs);
                
                img.onload = () => {
                    clearTimeout(timeoutId);
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                    console.log('✅ Image loaded successfully in', elapsed, 'seconds');
                    console.log('📐 Image dimensions:', img.width, 'x', img.height);
                    resolve(img);
                };
                
                img.onerror = (error) => {
                    clearTimeout(timeoutId);
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                    console.error('❌ Image load failed after', elapsed, 'seconds');
                    console.error('❌ Error event:', error);
                    console.error('🔍 Check Network tab for details (F12 → Network)');
                    console.error('🔍 Common issues:');
                    console.error('   - Browser extension blocking (disable ad blockers)');
                    console.error('   - CORS policy error');
                    console.error('   - Firewall/antivirus blocking');
                    console.error('   - DNS/network issue');
                    reject(new Error('Failed to load generated image'));
                };
                
                console.log('⏳ Loading image...');
                img.src = url;
            });
        };
        
        const img = await loadImageWithTimeout(imageUrl);
        
        // Success!
        backgroundImage = img;
        aiImageStatus.innerHTML = 'Vision rendered successfully! ✨ <small style="color: #666;">(If you see a rate limit message, click "Try Backup Renderer")</small>';
        aiImageStatus.style.color = '#4CAF50';
        
        // Analytics: Track successful AI image generation
        if (typeof gtag !== 'undefined') {
            gtag('event', 'artistic_ai_success');
        }
        
        // Play notification sound
        playNotificationSound();
        
        bgPreviewImage.src = imageUrl;
        bgPreviewSection.style.display = 'block';
        blendControlsSection.style.display = 'block';
        updateValidationStatus('idle', 'Click "Generate QR Code" to test');
        isGeneratingAI = false;
        cancelAIGeneration = false;
        generateAiImageBtn.disabled = false;
        generateAiImageBtn.textContent = 'Render Image';
        cancelAiImageBtn.style.display = 'none';
        tryBackupRendererBtn.style.display = 'inline-block';
        
        // Save AI metadata so downloads embed the prompt and generator info
        lastAiBackgroundMeta = {
            prompt: prompt,
            imageUrl: imageUrl,
            generatedAt: Date.now()
        };

        // Regenerate QR (now with artistic background) and add to bucket automatically
        try {
            generateQRCode();
            setTimeout(() => {
                try { addQRToBucket(); } catch (e) { console.warn('Failed to auto-add to bucket', e); }
            }, 150);
        } catch (e) {
            console.warn('Failed to auto-generate QR after AI background', e);
        }
        
    } catch (error) {
        console.error('AI image generation error (attempt ' + attempt + '):', error);
        
        // Check if cancelled
        if (cancelAIGeneration) {
            console.log('🚫 Generation cancelled by user');
            return;
        }
        
        // Retry logic
        if (attempt < maxAttempts) {
            aiImageStatus.textContent = `Attempt ${attempt} failed. Retrying with different seed...`;
            aiImageStatus.style.color = '#1565C0';
            
            // Wait a bit before retrying (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
            
            // Retry
            return generateAIImageWithRetry(prompt, attempt + 1, maxAttempts);
        } else {
            // All Pollinations attempts failed - try Stable Horde as fallback
            console.error('🚫 All Pollinations.ai attempts failed. Trying Stable Horde (community backup)...');
            console.log('🔄 Switching to Stable Horde API (community-powered, slower but reliable)');
            
            aiImageStatus.textContent = 'Primary service unavailable. Trying backup renderer (may take 30-60 seconds)...';
            aiImageStatus.style.color = '#1565C0';
            
            try {
                const hordeImage = await generateWithStableHorde(prompt);
                // Success with fallback!
                backgroundImage = hordeImage;
                aiImageStatus.textContent = 'Vision rendered successfully (via backup service)! ✨';
                aiImageStatus.style.color = '#4CAF50';
                
                // Hide progress bar
                const progressContainer = document.getElementById('aiProgressContainer');
                if (progressContainer) {
                    setTimeout(() => {
                        progressContainer.style.display = 'none';
                        const progressBar = document.getElementById('aiProgressBar');
                        if (progressBar) {
                            progressBar.style.width = '0%';
                        }
                    }, 2000); // Hide after 2 seconds
                }
                
                bgPreviewImage.src = hordeImage.src;
                bgPreviewSection.style.display = 'block';
                blendControlsSection.style.display = 'block';
                updateValidationStatus('idle', 'Click "Generate QR Code" to test');
                isGeneratingAI = false;
                generateAiImageBtn.disabled = false;
                generateAiImageBtn.textContent = 'Render Image';
                cancelAiImageBtn.style.display = 'none';
                // Save AI metadata and auto-add to bucket
                lastAiBackgroundMeta = {
                    prompt: prompt,
                    imageUrl: hordeImage.src,
                    generatedAt: Date.now()
                };
                try {
                    generateQRCode();
                    setTimeout(() => {
                        try { addQRToBucket(); } catch (e) { console.warn('Failed to auto-add to bucket', e); }
                    }, 150);
                } catch (e) {
                    console.warn('Failed to auto-generate QR after AI background', e);
                }
            } catch (hordeError) {
                console.error('❌ Stable Horde also failed:', hordeError);
                console.error('💡 Both rendering services unavailable. Use "Upload Image" tab instead.');
                
                // Hide progress bar
                const progressContainer = document.getElementById('aiProgressContainer');
                if (progressContainer) {
                    progressContainer.style.display = 'none';
                }
                
                aiImageStatus.innerHTML = 'Both rendering services unavailable. Please use the "Upload Image" tab or try again later.';
                aiImageStatus.style.color = '#f44336';
                isGeneratingAI = false;
                generateAiImageBtn.disabled = false;
                generateAiImageBtn.textContent = 'Render Image';
                cancelAiImageBtn.style.display = 'none';
            }
        }
    }
}

// Stable Horde fallback API (community-powered Stable Diffusion)
async function generateWithStableHorde(prompt) {
    console.log('🎨 Starting Stable Horde generation...');
    
    // Step 1: Submit generation request
    const submitUrl = 'https://stablehorde.net/api/v2/generate/async';
    const requestBody = {
        prompt: prompt + ", high quality, detailed",
        params: {
            width: 512,  // Smaller = faster on community GPUs
            height: 512,
            steps: 25,
            cfg_scale: 7.5,
            sampler_name: "k_lms",
            seed_variation: 1
        },
        nsfw: false,
        censor_nsfw: true,
        trusted_workers: true,
        r2: true  // Use R2 storage for faster image retrieval
    };
    
    console.log('📤 Submitting request to Stable Horde...');
    console.log('📋 Request body:', JSON.stringify(requestBody, null, 2));
    
    const submitResponse = await fetch(submitUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': '0000000000'  // Anonymous key for public access
        },
        body: JSON.stringify(requestBody)
    });
    
    if (!submitResponse.ok) {
        throw new Error('Failed to submit to Stable Horde: ' + submitResponse.status);
    }
    
    const submitData = await submitResponse.json();
    const requestId = submitData.id;
    console.log('✅ Request submitted. ID:', requestId);
    console.log('⏳ Waiting for community GPU (this may take 30-60 seconds)...');
    
    // Step 2: Poll for completion
    const checkUrl = `https://stablehorde.net/api/v2/generate/check/${requestId}`;
    let attempts = 0;
    const maxPollAttempts = 180; // 180 attempts * 2 seconds = ~6 minutes max (increased per user request)
    
    while (attempts < maxPollAttempts) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds between polls
        attempts++;
        
        // Check if cancelled
        if (cancelAIGeneration || cancelBackupRenderer) {
            console.log('🚫 Stable Horde generation cancelled by user');
            throw new Error('Generation cancelled by user');
        }
        
        console.log(`🔍 Checking status (${attempts}/${maxPollAttempts})...`);
        const elapsedSeconds = attempts * 2;
        const elapsedMinutes = Math.floor(elapsedSeconds / 60);
        const elapsedSecs = elapsedSeconds % 60;
        const elapsedFormatted = `${elapsedMinutes}:${elapsedSecs.toString().padStart(2, '0')}`;
        aiImageStatus.textContent = `Rendering with alternate (${elapsedFormatted} elapsed, in queue...)`;
        aiImageStatus.style.color = '#1565C0';
        
        const checkResponse = await fetch(checkUrl);
        const checkData = await checkResponse.json();
        
        // Format wait time as minutes:seconds
        const waitSeconds = checkData.wait_time || 0;
        const minutes = Math.floor(waitSeconds / 60);
        const seconds = Math.round(waitSeconds % 60);
        const waitTimeFormatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        
        console.log('📊 Queue position:', checkData.queue_position, '| Wait time:', waitTimeFormatted);
        
        if (checkData.done) {
            console.log('✅ Generation complete! Fetching image...');
            
            // Set progress to 100%
            const progressBar = document.getElementById('aiProgressBar');
            if (progressBar) {
                progressBar.style.width = '100%';
                progressBar.textContent = '100%';
            }
            
            // Play notification sound
            playNotificationSound();
            
            // Step 3: Get the final status with image URL
            const statusUrl = `https://stablehorde.net/api/v2/generate/status/${requestId}`;
            const statusResponse = await fetch(statusUrl);
            const statusData = await statusResponse.json();
            
            if (statusData.generations && statusData.generations.length > 0) {
                const imageUrl = statusData.generations[0].img;
                console.log('🖼️ Image URL:', imageUrl);
                
                // Load the image and crop watermark
                return new Promise((resolve, reject) => {
                    const img = new Image();
                    img.crossOrigin = 'anonymous';
                    
                    img.onload = () => {
                        console.log('✅ Stable Horde image loaded successfully!');
                        console.log('🔧 Cropping watermark from bottom...');
                        
                        // Create canvas to crop watermark (remove bottom ~40 pixels)
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        
                        const cropHeight = 40; // Height of watermark to remove
                        canvas.width = img.width;
                        canvas.height = img.height - cropHeight;
                        
                        // Draw image without bottom portion
                        ctx.drawImage(img, 0, 0, img.width, img.height - cropHeight, 0, 0, canvas.width, canvas.height);
                        
                        // Convert back to image
                        const croppedImg = new Image();
                        croppedImg.onload = () => {
                            console.log('✅ Watermark cropped successfully!');
                            resolve(croppedImg);
                        };
                        croppedImg.src = canvas.toDataURL('image/png');
                    };
                    
                    img.onerror = () => {
                        reject(new Error('Failed to load Stable Horde image'));
                    };
                    
                    img.src = imageUrl;
                });
            } else {
                throw new Error('No image generated by Stable Horde');
            }
        }
        
        if (checkData.faulted) {
            throw new Error('Stable Horde generation faulted');
        }
        
        // Update status with queue info
        if (checkData.queue_position !== undefined) {
            const waitSeconds = checkData.wait_time || 30;
            const minutes = Math.floor(waitSeconds / 60);
            const seconds = Math.round(waitSeconds % 60);
            const waitTimeFormatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            
            const elapsedSeconds = attempts * 2;
            const elapsedMinutes = Math.floor(elapsedSeconds / 60);
            const elapsedSecs = elapsedSeconds % 60;
            const elapsedFormatted = `${elapsedMinutes}:${elapsedSecs.toString().padStart(2, '0')}`;
            
            // Position 0 means actively processing, not in queue
            if (checkData.queue_position === 0) {
                aiImageStatus.textContent = `🎨 Processing now (${waitTimeFormatted} estimated) • ${elapsedFormatted} elapsed`;
            } else {
                aiImageStatus.textContent = `⏳ Queue position ${checkData.queue_position} (${waitTimeFormatted} estimated) • ${elapsedFormatted} elapsed`;
            }
            aiImageStatus.style.color = '#1565C0';
            
            // Update progress bar
            const progressContainer = document.getElementById('aiProgressContainer');
            const progressBar = document.getElementById('aiProgressBar');
            if (progressContainer && progressBar) {
                progressContainer.style.display = 'block';
                
                // Calculate progress: 0% at start, 100% when done
                // Use elapsed time vs estimated total time
                const totalEstimated = elapsedSeconds + waitSeconds;
                const progress = Math.min(95, Math.max(5, (elapsedSeconds / totalEstimated) * 100));
                
                progressBar.style.width = progress + '%';
                progressBar.textContent = Math.round(progress) + '%';
            }
        }
    }
    
    throw new Error('Stable Horde generation timed out after 2 minutes');
}

// Blend controls
blendModeSelect.addEventListener('change', (e) => {
    currentBlendMode = e.target.value;
    if (currentQRDataURL && backgroundImage) {
        saveCurrentState(`Changed blend mode to ${e.target.value}`);
        // Analytics: Track blend mode change
        if (typeof gtag !== 'undefined') {
            gtag('event', 'artistic_blend_mode_changed', {
                'mode': e.target.value
            });
        }
        generateQRCode();
    }
});

bgOpacityRange.addEventListener('input', (e) => {
    bgOpacityValue.textContent = e.target.value;
});

bgOpacityRange.addEventListener('change', (e) => {
    currentBgOpacity = parseInt(e.target.value);
    if (currentQRDataURL && backgroundImage) {
        saveCurrentState(`Changed background opacity to ${e.target.value}%`);
        // Analytics: Track opacity adjustment
        if (typeof gtag !== 'undefined') {
            gtag('event', 'artistic_opacity_adjusted', {
                'value': parseInt(e.target.value)
            });
        }
        generateQRCode();
    }
});

qrStrengthRange.addEventListener('input', (e) => {
    qrStrengthValue.textContent = e.target.value;
});

qrStrengthRange.addEventListener('change', (e) => {
    currentQrStrength = parseInt(e.target.value);
    if (currentQRDataURL && backgroundImage) {
        saveCurrentState(`Changed QR strength to ${e.target.value}%`);
        // Analytics: Track QR strength adjustment
        if (typeof gtag !== 'undefined') {
            gtag('event', 'artistic_qr_strength_adjusted', {
                'value': parseInt(e.target.value)
            });
        }
        generateQRCode();
    }
});

// ============================================
// PROMPT HELPER FUNCTIONALITY
// ============================================

// Toggle prompt helper visibility
togglePromptHelperBtn.addEventListener('click', () => {
    const isHidden = promptHelperContent.style.display === 'none';
    promptHelperContent.style.display = isHidden ? 'block' : 'none';
    const icon = togglePromptHelperBtn.querySelector('.toggle-icon');
    if (isHidden) {
        icon.classList.add('rotated');
    } else {
        icon.classList.remove('rotated');
    }
});

// Generate prompt suggestions
generatePromptBtn.addEventListener('click', () => {
    generatePromptSuggestions();
});

retryPromptBtn.addEventListener('click', () => {
    generatePromptSuggestions();
});

function generatePromptSuggestions() {
    const context = contextInput.value.trim();
    
    if (!context) {
        alert('Please enter what your QR code is for (e.g., "coffee shop business card")');
        contextInput.focus();
        return;
    }
    
    // Show loading state
    promptSuggestions.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;"><div class="spinner" style="display: inline-block; width: 20px; height: 20px; border: 3px solid #f3f3f3; border-top: 3px solid #667eea; border-radius: 50%; animation: spin 1s linear infinite;"></div><br>Generating creative ideas with AI...</div>';
    promptSuggestions.style.display = 'block';
    retryPromptBtn.style.display = 'none';
    setGeminiModelStatus(`AI model: Selecting best option (current ${workingGeminiModel})...`, '#1565C0');
    
    // Call Gemini API to generate image prompts
    generatePromptWithGemini(context)
        .then(suggestions => {
            displayPromptSuggestions(suggestions);
        })
        .catch(error => {
            console.error('Failed to generate prompts:', error);
            console.error('Error details:', error.message);
            
            // Check if it's a rate limit error (429)
            if (error.message.includes('429') || error.message.toLowerCase().includes('quota')) {
                // Rate limit hit - offer auto-retry
                let countdown = 60;
                promptSuggestions.innerHTML = `<div style="text-align: center; padding: 20px; color: #FF9800;">
                    <strong>⏱️ Rate Limit Reached</strong><br>
                    <span style="font-size: 0.95em; margin-top: 8px; display: inline-block;">The free API allows 15 requests per minute.</span><br>
                    <span style="font-size: 0.9em; color: #666; margin-top: 8px; display: inline-block;">Auto-retrying in <span id="countdown">${countdown}</span> seconds...</span><br>
                    <button id="cancelRetry" style="margin-top: 12px; padding: 6px 16px; background: #f44336; color: white; border: none; border-radius: 6px; cursor: pointer;">Cancel</button>
                </div>`;
                promptSuggestions.style.display = 'block';
                retryPromptBtn.style.display = 'none';
                
                const countdownElement = document.getElementById('countdown');
                const cancelButton = document.getElementById('cancelRetry');
                
                const intervalId = setInterval(() => {
                    countdown--;
                    if (countdownElement) {
                        countdownElement.textContent = countdown;
                    }
                    if (countdown <= 0) {
                        clearInterval(intervalId);
                        generatePromptSuggestions(); // Retry automatically
                    }
                }, 1000);
                
                if (cancelButton) {
                    cancelButton.addEventListener('click', () => {
                        clearInterval(intervalId);
                        promptSuggestions.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">Retry cancelled. Click "Generate Description Ideas" when ready.</div>';
                        retryPromptBtn.style.display = 'block';
                    });
                }
            } else {
                // Other errors
                promptSuggestions.innerHTML = `<div style="text-align: center; padding: 20px; color: #f44336;">
                    <strong>Failed to generate ideas.</strong><br>
                    <span style="font-size: 0.9em; color: #666;">Error: ${error.message}</span><br>
                    <span style="font-size: 0.9em; color: #666;">Check browser console for details.</span>
                </div>`;
                retryPromptBtn.style.display = 'block';
            }
        });
}

// ============================================
// PLACE ID SEARCH (Google Review mode)
// ============================================

let mapsApiLoaded = false;
let mapsApiLoading = false;
let mapsApiCallbacks = [];

function loadGoogleMapsAPI() {
    return new Promise((resolve, reject) => {
        if (mapsApiLoaded && window.google && window.google.maps && window.google.maps.places) {
            resolve();
            return;
        }
        mapsApiCallbacks.push({ resolve, reject });
        if (mapsApiLoading) return;
        mapsApiLoading = true;

        window.__googleMapsApiReady = function() {
            mapsApiLoaded = true;
            mapsApiLoading = false;
            mapsApiCallbacks.forEach(cb => cb.resolve());
            mapsApiCallbacks = [];
        };

        const script = document.createElement('script');
        // v=beta enables AutocompleteSuggestion (Places API New)
        script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places&v=beta&loading=async&callback=__googleMapsApiReady`;
        script.async = true;
        script.onerror = () => {
            mapsApiLoading = false;
            const err = new Error('Failed to load Google Maps API. Check your key and confirm the Places API is enabled.');
            mapsApiCallbacks.forEach(cb => cb.reject(err));
            mapsApiCallbacks = [];
        };
        document.head.appendChild(script);
    });
}

async function searchPlaceId(query) {
    if (!placeSearchStatus) return;
    placeSearchResults.innerHTML = '';

    if (!GOOGLE_MAPS_API_KEY) {
        placeSearchStatus.textContent = 'No Maps API key set — see setup instructions above.';
        placeSearchStatus.style.color = '#f57c00';
        return;
    }

    placeSearchStatus.textContent = 'Searching\u2026';
    placeSearchStatus.style.color = '#1565C0';

    try {
        await loadGoogleMapsAPI();

        // Use Places API (New): AutocompleteSuggestion
        const { suggestions } = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: query,
            includedPrimaryTypes: ['establishment']
        });

        if (!suggestions || suggestions.length === 0) {
            placeSearchStatus.textContent = 'No businesses found. Try a more specific name or include a city.';
            placeSearchStatus.style.color = '#666';
            return;
        }

        placeSearchStatus.textContent = `${suggestions.length} result(s) — click one to populate the Place ID.`;
        placeSearchStatus.style.color = '#4CAF50';

        suggestions.slice(0, 6).forEach(suggestion => {
            const pred = suggestion.placePrediction;
            const placeId = pred.placeId;
            const name = pred.mainText ? pred.mainText.toString() : pred.text.toString();
            const address = pred.secondaryText ? pred.secondaryText.toString() : '';

            const card = document.createElement('div');
            card.className = 'place-result-card';

            const nameEl = document.createElement('div');
            nameEl.className = 'place-result-name';
            nameEl.textContent = name;

            const addrEl = document.createElement('div');
            addrEl.className = 'place-result-address';
            addrEl.textContent = address;

            const idEl = document.createElement('div');
            idEl.className = 'place-result-id';
            idEl.textContent = `ID: ${placeId}`;

            card.appendChild(nameEl);
            card.appendChild(addrEl);
            card.appendChild(idEl);

            card.addEventListener('click', () => {
                const url = `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
                textInput.value = url;
                generateQRCode();
                placeSearchStatus.textContent = `✅ Place ID set for: ${name}`;
                placeSearchStatus.style.color = '#4CAF50';
                document.querySelectorAll('.place-result-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                if (typeof gtag !== 'undefined') {
                    gtag('event', 'place_id_selected');
                }
            });
            placeSearchResults.appendChild(card);
        });
    } catch (error) {
        placeSearchStatus.textContent = `Search failed: ${error.message}`;
        placeSearchStatus.style.color = '#f44336';
        console.error('Place search error:', error);
    }
}

if (placeSearchBtn) {
    placeSearchBtn.addEventListener('click', () => {
        const q = placeSearchInput ? placeSearchInput.value.trim() : '';
        if (q) searchPlaceId(q);
    });
}

if (placeSearchInput) {
    placeSearchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            const q = placeSearchInput.value.trim();
            if (q) searchPlaceId(q);
        }
    });
}

function loadCachedGeminiModel() {
    try {
        const raw = localStorage.getItem(GEMINI_WORKING_MODEL_CACHE_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.model !== 'string' || typeof parsed.timestamp !== 'number') {
            return null;
        }

        const isFresh = (Date.now() - parsed.timestamp) < GEMINI_WORKING_MODEL_TTL_MS;
        if (!isFresh) return null;

        return parsed.model;
    } catch (error) {
        return null;
    }
}

function saveCachedGeminiModel(model) {
    try {
        localStorage.setItem(GEMINI_WORKING_MODEL_CACHE_KEY, JSON.stringify({
            model,
            timestamp: Date.now()
        }));
    } catch (error) {
        // Ignore storage failures (private mode/quota)
    }
}

function setGeminiModelStatus(text, color = '#5f6368') {
    if (!aiModelStatus) return;
    aiModelStatus.textContent = text;
    aiModelStatus.style.color = color;
}

function updateGeminiModelStatus(model, source = 'Active') {
    if (!model) {
        setGeminiModelStatus('AI model: Waiting for selection...');
        return;
    }

    setGeminiModelStatus(`AI model (${source}): ${model}`);
}

function rankGeminiModel(modelName) {
    const name = String(modelName || '').toLowerCase();

    if (!name.startsWith('gemini-')) return 1000;
    if (name.includes('embedding')) return 1000;

    let score = 500;

    if (name.includes('gemini-2.0-flash')) score = 0;
    else if (name.includes('gemini-2') && name.includes('flash')) score = 10;
    else if (name.includes('gemini-1.5-flash')) score = 20;
    else if (name.includes('gemini-1.5-pro')) score = 40;
    else if (name.includes('flash')) score = 80;
    else if (name.includes('pro')) score = 120;

    if (name.includes('preview') || name.includes('exp') || name.includes('experimental')) {
        score += 200;
    }

    return score;
}

async function discoverGeminiGenerateContentModels() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GEMINI_DISCOVERY_TIMEOUT_MS);

    try {
        for (const baseUrl of GEMINI_API_BASES) {
            const response = await fetch(`${baseUrl}/models?key=${GEMINI_API_KEY}`, {
                signal: controller.signal
            });

            if (!response.ok) {
                console.warn(`Gemini model discovery failed on ${baseUrl} (${response.status})`);
                continue;
            }

            const data = await response.json();
            if (!data || !Array.isArray(data.models)) continue;

            const discovered = data.models
                .filter(model => Array.isArray(model.supportedGenerationMethods) && model.supportedGenerationMethods.includes('generateContent'))
                .map(model => String(model.name || '').replace(/^models\//, ''))
                .filter(name => name.startsWith('gemini-'));

            if (discovered.length > 0) {
                return Array.from(new Set(discovered)).sort((a, b) => rankGeminiModel(a) - rankGeminiModel(b));
            }
        }

        return [];
    } catch (error) {
        console.warn('Gemini model discovery error:', error.message);
        return [];
    } finally {
        clearTimeout(timeoutId);
    }
}

async function getGeminiModelsToTry() {
    const now = Date.now();
    if (!lastGeminiDiscoveryAt || (now - lastGeminiDiscoveryAt) > GEMINI_DISCOVERY_REFRESH_MS) {
        discoveredGeminiModels = await discoverGeminiGenerateContentModels();
        lastGeminiDiscoveryAt = now;

        if (discoveredGeminiModels.length > 0) {
            setGeminiModelStatus(`AI model: ${workingGeminiModel} (${discoveredGeminiModels.length} discovered)`, '#1565C0');
        }
    }

    // Preserve known-good + explicit fallbacks, then append discovered models.
    return Array.from(new Set([
        workingGeminiModel,
        ...GEMINI_MODELS,
        ...discoveredGeminiModels
    ].filter(Boolean)));
}

async function generatePromptWithGemini(context) {
    const prompt = `You are a creative AI image prompt expert helping generate descriptions for Stable Diffusion artistic QR code backgrounds.

User's context: "${context}"

Generate 3 diverse, creative image prompts optimized for AI art generation. Study these successful examples:
- "skillet with two fried eggs and bacon"
- "pancakes bacon scrambled eggs"
- "rainbow music art with black background"
- "Bees, honey comb and sunflowers with white background"
- "gum trees on a white background"
- "neon cats and balls of yarn"
- "galactic explosion hindu symbols"
- "wealthy forest masterpiece"

Your prompts should:
- Be 5-15 words, direct and concrete
- Specify main subjects/objects clearly (e.g., "coffee cup", "geometric shapes", "forest trees")
- Include color palette or background color when relevant
- Add artistic style descriptors (e.g., "neon", "watercolor", "realistic", "minimalist")
- Work well as QR backgrounds (clear subject, not overly complex)
- Be creative but concrete - avoid abstract concepts
- Vary significantly from each other in subject, color, and style

Return ONLY a JSON array with exactly 3 objects:
- "title": Short catchy name (2-4 words)
- "prompt": The image description (5-15 words)

Example response format:
[
  {"title":"Coffee Shop Vibes","prompt":"espresso cup with steam on rustic wood table warm brown tones"},
  {"title":"Tech Minimalist","prompt":"geometric hexagon patterns in electric blue and white clean modern style"},
  {"title":"Nature Organic","prompt":"green leaves with water droplets on white background botanical photography"}
]

Return ONLY valid JSON, no markdown, no other text.`;

    // Try cached/known models first, then discovered current models.
    const modelsToTry = await getGeminiModelsToTry();
    let lastError = null;
    
    for (const model of modelsToTry) {
        try {
            console.log(`🔄 Trying Gemini model: ${model}`);
            setGeminiModelStatus(`AI model: Trying ${model}...`, '#1565C0');
            let data = null;
            let modelWorked = false;

            for (const baseUrl of GEMINI_API_BASES) {
                const apiUrl = `${baseUrl}/models/${model}:generateContent`;

                const response = await fetch(`${apiUrl}?key=${GEMINI_API_KEY}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        contents: [{
                            parts: [{
                                text: prompt
                            }]
                        }],
                        generationConfig: {
                            temperature: 1.0,
                            maxOutputTokens: 1000
                        }
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.warn(`❌ Model ${model} failed on ${baseUrl} (${response.status}):`, errorText.substring(0, 100));
                    lastError = new Error(`${model} returned ${response.status}`);
                    continue;
                }

                data = await response.json();
                modelWorked = true;
                break;
            }

            if (!modelWorked || !data) {
                continue; // Try next model
            }
            
            if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
                console.warn(`❌ Model ${model} returned invalid structure`);
                lastError = new Error(`${model} invalid response structure`);
                continue; // Try next model
            }
            
            // Success! Cache this model for future use
            if (workingGeminiModel !== model) {
                console.log(`✅ Found working model: ${model} (updating cache)`);
                workingGeminiModel = model;
                saveCachedGeminiModel(model);
                updateGeminiModelStatus(model, 'Auto-selected');
            } else {
                console.log(`✅ Model ${model} working`);
                saveCachedGeminiModel(model);
                updateGeminiModelStatus(model, 'Active');
            }
            
            const textResponse = data.candidates[0].content.parts[0].text;
            
            // Extract JSON from response (remove markdown code blocks if present)
            let jsonText = textResponse.trim();
            if (jsonText.startsWith('```json')) {
                jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?$/g, '').trim();
            } else if (jsonText.startsWith('```')) {
                jsonText = jsonText.replace(/```\n?/g, '').trim();
            }
            
            const suggestions = JSON.parse(jsonText);
            
            // Validate format
            if (!Array.isArray(suggestions) || suggestions.length === 0) {
                throw new Error('Invalid response format from API');
            }
            
            // Ensure we have exactly 3 suggestions
            return suggestions.slice(0, 3);
            
        } catch (error) {
            console.warn(`❌ Model ${model} error:`, error.message);
            lastError = error;
            continue; // Try next model
        }
    }
    
    // All models failed
    console.error('❌ All Gemini models failed');
    setGeminiModelStatus('AI model: unavailable (all candidates failed)', '#f44336');
    throw lastError || new Error('All Gemini models unavailable');
}

function displayPromptSuggestions(suggestions) {
    // Store suggestions for metadata tracking
    lastGeneratedSuggestions = suggestions;
    
    // Display suggestions
    promptSuggestions.innerHTML = '';
    promptSuggestions.style.display = 'flex';
    retryPromptBtn.style.display = 'block';
    
    suggestions.forEach((suggestion, index) => {
        const card = document.createElement('div');
        card.className = 'prompt-suggestion-card';
        card.innerHTML = `
            <div class="suggestion-title">${suggestion.title}</div>
            <div class="suggestion-text">${suggestion.prompt}</div>
            <div class="use-icon">→</div>
        `;
        
        card.addEventListener('click', () => {
            aiPromptInput.value = suggestion.prompt;
            aiPromptInput.focus();
            
            // Highlight briefly
            card.style.background = '#e8f5e9';
            card.style.borderColor = '#4CAF50';
            setTimeout(() => {
                card.style.background = 'white';
                card.style.borderColor = '#e0e0e0';
            }, 500);
        });
        
        promptSuggestions.appendChild(card);
    });
}

function createPromptSuggestions(context) {
    // Smart template-based generation with keyword matching
    const keywords = {
        business: ['business', 'company', 'corporate', 'professional', 'office', 'startup'],
        food: ['restaurant', 'cafe', 'coffee', 'food', 'dining', 'menu', 'bakery', 'bar'],
        tech: ['tech', 'software', 'app', 'digital', 'web', 'coding', 'ai', 'data'],
        creative: ['art', 'design', 'creative', 'studio', 'photography', 'music'],
        event: ['wedding', 'event', 'party', 'conference', 'concert', 'festival'],
        health: ['health', 'fitness', 'gym', 'medical', 'wellness', 'yoga'],
        education: ['school', 'education', 'learning', 'course', 'university'],
        nature: ['nature', 'eco', 'green', 'organic', 'natural', 'sustainable'],
        luxury: ['luxury', 'premium', 'elegant', 'boutique', 'exclusive']
    };
    
    // Detect category
    let category = 'general';
    for (const [key, words] of Object.entries(keywords)) {
        if (words.some(word => context.includes(word))) {
            category = key;
            break;
        }
    }
    
    // Template library organized by category
    const templates = {
        business: [
            { title: 'Modern Professional', prompt: 'Clean geometric patterns in navy blue and gold, modern minimalist style, corporate elegance' },
            { title: 'Corporate Gradient', prompt: 'Smooth gradient from dark blue to light blue, subtle abstract shapes, professional business aesthetic' },
            { title: 'Tech Forward', prompt: 'Digital circuit board pattern in blue and silver, futuristic tech aesthetic, clean lines' }
        ],
        food: [
            { title: 'Warm & Inviting', prompt: 'Warm coffee tones with steam wisps, cozy cafe atmosphere, soft lighting, watercolor style' },
            { title: 'Fresh & Natural', prompt: 'Fresh herbs and ingredients, rustic wooden texture, natural earth tones, organic feel' },
            { title: 'Elegant Dining', prompt: 'Elegant table setting with soft candlelight, muted gold and cream colors, sophisticated ambiance' }
        ],
        tech: [
            { title: 'Cyberpunk Vibes', prompt: 'Neon circuit patterns in electric blue and purple, futuristic digital interface, glowing lines' },
            { title: 'Minimal Tech', prompt: 'Clean white space with geometric blue accents, modern tech aesthetic, minimalist digital art' },
            { title: 'Data Flow', prompt: 'Abstract data visualization, flowing particles in blue and green, high-tech sci-fi style' }
        ],
        creative: [
            { title: 'Artistic Splash', prompt: 'Vibrant watercolor splashes in rainbow colors, creative abstract art, fluid organic shapes' },
            { title: 'Bold Brushstrokes', prompt: 'Bold acrylic brush strokes in bright colors, artistic energy, modern art style' },
            { title: 'Dreamy Pastels', prompt: 'Soft pastel clouds in pink and purple, dreamy artistic atmosphere, ethereal aesthetic' }
        ],
        event: [
            { title: 'Elegant Celebration', prompt: 'Soft rose gold with delicate floral patterns, elegant celebration theme, romantic atmosphere' },
            { title: 'Festive Energy', prompt: 'Colorful confetti and light bokeh effects, joyful celebration mood, vibrant party vibes' },
            { title: 'Timeless Classic', prompt: 'Ivory and gold ornamental patterns, classic elegance, vintage luxury feel' }
        ],
        health: [
            { title: 'Fresh & Energetic', prompt: 'Bright lime green with water droplets, fresh energetic vibe, healthy lifestyle aesthetic' },
            { title: 'Zen Calm', prompt: 'Peaceful bamboo forest with soft light, calming zen atmosphere, natural tranquility' },
            { title: 'Vitality Burst', prompt: 'Orange and yellow sunrise gradients, energetic vitality, dynamic health theme' }
        ],
        nature: [
            { title: 'Forest Serenity', prompt: 'Peaceful forest with sunlight through trees, natural green tones, serene woodland atmosphere' },
            { title: 'Ocean Calm', prompt: 'Turquoise ocean waves with soft foam, peaceful seaside, calming blue water tones' },
            { title: 'Mountain Majesty', prompt: 'Majestic mountain peaks with purple sunset, natural grandeur, inspiring landscape' }
        ],
        luxury: [
            { title: 'Gold Elegance', prompt: 'Luxurious gold marble texture with black veins, premium sophisticated aesthetic' },
            { title: 'Velvet Night', prompt: 'Deep burgundy velvet texture with gold accents, luxury elegance, rich opulent feel' },
            { title: 'Crystal Shimmer', prompt: 'Crystalline patterns with champagne gold shimmer, exclusive luxury, refined elegance' }
        ],
        general: [
            { title: 'Abstract Modern', prompt: 'Smooth color gradient in purple and blue, modern abstract style, clean aesthetic' },
            { title: 'Geometric Clean', prompt: 'Simple geometric shapes in soft colors, minimalist clean design, contemporary feel' },
            { title: 'Soft Gradient', prompt: 'Gentle gradient from pink to purple, soft dreamy atmosphere, pastel aesthetic' }
        ]
    };
    
    // Get templates for the detected category
    let categoryTemplates = templates[category] || templates.general;
    
    // Shuffle and return 3
    const shuffled = [...categoryTemplates].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 3);
}

// Validation status update function
function updateValidationStatus(status, message, suggestions = null) {
    const indicator = validationIndicator;
    const icon = indicator.querySelector('.indicator-icon');
    const text = indicator.querySelector('.indicator-text');
    
    indicator.className = 'validation-indicator';
    text.innerHTML = ''; // Clear previous content
    
    switch(status) {
        case 'testing':
            indicator.classList.add('testing');
            icon.textContent = '⏳';
            text.textContent = 'Testing scannability...';
            break;
        case 'valid':
            indicator.classList.add('valid');
            icon.textContent = '✓';
            text.textContent = message || 'QR code is scannable!';
            break;
        case 'invalid':
            indicator.classList.add('invalid');
            icon.textContent = '✗';
            
            // Add message text
            const messageSpan = document.createElement('span');
            messageSpan.textContent = message || 'QR code may not scan properly';
            text.appendChild(messageSpan);
            
            // Add clickable suggestions if provided
            if (suggestions && suggestions.length > 0) {
                const suggestionContainer = document.createElement('div');
                suggestionContainer.style.marginTop = '8px';
                suggestionContainer.style.display = 'flex';
                suggestionContainer.style.flexDirection = 'column';
                suggestionContainer.style.gap = '6px';
                
                suggestions.forEach(suggestion => {
                    const suggestionBtn = document.createElement('button');
                    suggestionBtn.textContent = suggestion.text;
                    suggestionBtn.className = 'suggestion-btn';
                    suggestionBtn.style.cssText = `
                        padding: 6px 12px;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                        border: none;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 12px;
                        font-weight: 500;
                        transition: all 0.2s;
                        text-align: left;
                    `;
                    
                    suggestionBtn.addEventListener('mouseover', () => {
                        suggestionBtn.style.transform = 'translateX(4px)';
                        suggestionBtn.style.boxShadow = '0 2px 8px rgba(102, 126, 234, 0.4)';
                    });
                    
                    suggestionBtn.addEventListener('mouseout', () => {
                        suggestionBtn.style.transform = 'translateX(0)';
                        suggestionBtn.style.boxShadow = 'none';
                    });
                    
                    suggestionBtn.addEventListener('click', () => {
                        suggestion.action();
                    });
                    
                    suggestionContainer.appendChild(suggestionBtn);
                });
                
                text.appendChild(suggestionContainer);
            }
            break;
        case 'idle':
        default:
            icon.textContent = '⏳';
            text.textContent = message || 'Click "Generate QR Code" to test';
            break;
    }
}

// Logo selection
selectLogoBtn.addEventListener('click', () => {
    logoInput.click();
});

logoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            // Show cropper instead of directly loading image
            showImageCropper(event.target.result, 'logo', file.name);
        };
        reader.readAsDataURL(file);
    }
});

clearLogoBtn.addEventListener('click', () => {
    selectedLogo = null;
    logoInput.value = '';
    logoStatus.textContent = 'No logo selected';
    logoStatus.style.color = '#888';
    
    // Regenerate QR code if one exists
    if (currentQRDataURL) {
        saveCurrentState('Removed logo');
        // Analytics: Track logo removed
        if (typeof gtag !== 'undefined') {
            gtag('event', 'logo_removed');
        }
        generateQRCode();
    }
});

// Clear label
clearLabelBtn.addEventListener('click', () => {
    labelInput.value = '';
    if (currentQRDataURL) {
        saveCurrentState('Cleared label');
        generateQRCode();
    }
});

// Bucket functionality
addToBucketBtn.addEventListener('click', addQRToBucket);
clearBucketBtn.addEventListener('click', clearBucket);

function addQRToBucket() {
    if (!currentQRDataURL) {
        alert('Please generate a QR code first!');
        return;
    }
    
    if (qrBucket.length >= MAX_BUCKET_SIZE_OTHER) {
        alert(`Maximum ${MAX_BUCKET_SIZE_OTHER} QR codes allowed in bucket!`);
        // Analytics: Track bucket limit reached
        if (typeof gtag !== 'undefined') {
            gtag('event', 'bucket_limit_reached', {
                'max_size': MAX_BUCKET_SIZE_OTHER
            });
        }
        return;
    }
    
    // Capture complete metadata
    const metadata = {
        // Core data
        text: textInput.value.trim(),
        label: labelInput.value.trim(),
        notes: qrNotesInput ? qrNotesInput.value.trim() : '',
        timestamp: Date.now(),
        
        // Settings
        settings: {
            size: parseInt(sizeRange.value),
            border: parseInt(borderRange.value),
            logoSize: parseInt(logoSizeRange.value),
            labelSize: parseInt(labelSizeRange.value)
        },
        
        // Colors
        colors: {
            dark: currentDarkColor,
            light: currentLightColor,
            label: currentLabelColor
        },
        
        // Style
        style: currentQRStyle,
        
        // Error Correction
        errorCorrection: currentErrorCorrectionLevel,
        
        // Logo
        logo: {
            hasLogo: selectedLogo !== null,
            logoDataURL: selectedLogo ? selectedLogo.src : null
        },
        
        // Artistic QR with enhanced tracking
        artistic: {
            hasBackground: backgroundImage !== null,
            backgroundDataURL: backgroundImage ? bgPreviewImage.src : null,
            blendMode: currentBlendMode,
            bgOpacity: currentBgOpacity,
            qrStrength: currentQrStrength,
            aiBackground: lastAiBackgroundMeta || null,
            // New: Track user's context and prompt
            context: contextInput ? contextInput.value.trim() : '',
            imagePrompt: aiPromptInput ? aiPromptInput.value.trim() : '',
            allGeneratedSuggestions: lastGeneratedSuggestions || null, // Store all suggestions
            // Link prompt to generated image
            promptToImageMapping: backgroundImage ? {
                prompt: aiPromptInput ? aiPromptInput.value.trim() : '',
                imageDataURL: bgPreviewImage.src,
                generatedAt: lastAiBackgroundMeta ? lastAiBackgroundMeta.timestamp : Date.now()
            } : null
        }
    };

    // Compute analytics
    const analytics = computeAnalytics(parseInt(sizeRange.value || qrCanvas.width));

    // Embed metadata and analytics into PNG tEXt chunks
    let dataWithMeta = currentQRDataURL;
    try {
        dataWithMeta = insertTextChunkToPNG(dataWithMeta, 'QR_META', JSON.stringify(metadata));
        dataWithMeta = insertTextChunkToPNG(dataWithMeta, 'QR_ANALYTICS', JSON.stringify(analytics));
    } catch (e) {
        console.warn('Failed to embed metadata into bucket PNG', e);
        dataWithMeta = currentQRDataURL;
    }
    
    // Store QR code data with metadata (dataURL now includes embedded metadata)
    // Deselect all existing QRs
    qrBucket.forEach(qr => qr.selected = false);
    
    const qrData = {
        dataURL: dataWithMeta,
        canvas: cloneCanvas(qrCanvas),
        metadata: metadata,
        analytics: analytics,
        selected: true // Auto-select the newly added QR
    };
    
    qrBucket.push(qrData);
    qrMetadataHistory.push(metadata);
    
    // Analytics: Track QR added to bucket
    if (typeof gtag !== 'undefined') {
        gtag('event', 'bucket_qr_added', {
            'bucket_count': qrBucket.length,
            'has_logo': metadata.logo.hasLogo,
            'has_label': metadata.label !== '',
            'has_artistic': metadata.artistic.hasBackground,
            'style': metadata.style
        });
    }
    
    updateBucketUI();
    showNotification(`Added to bucket! (${qrBucket.length}/${MAX_BUCKET_SIZE_OTHER})`);
    
    // Clear notes input for next code
    if (qrNotesInput) {
        qrNotesInput.value = '';
    }
}

function cloneCanvas(sourceCanvas) {
    const clone = document.createElement('canvas');
    clone.width = sourceCanvas.width;
    clone.height = sourceCanvas.height;
    const ctx = clone.getContext('2d');
    ctx.drawImage(sourceCanvas, 0, 0);
    return clone;
}

function updateBucketUI() {
    const countText = `(${qrBucket.length}/${MAX_BUCKET_SIZE_OTHER})`;
    bucketCount.textContent = countText;
    if (bucketCountBtn) {
        bucketCountBtn.textContent = countText;
    }
    
    // Update download section title based on metadata presence
    if (downloadSectionTitle) {
        if (qrBucket.length > 0) {
            downloadSectionTitle.textContent = 'Download QR Code (+metadata)';
        } else {
            downloadSectionTitle.textContent = 'Download QR Code';
        }
    }
    
    if (qrBucket.length > 0) {
        bucketSection.style.display = 'block';
        
        // Update preview thumbnails
        bucketPreview.innerHTML = '';
        qrBucket.forEach((qr, index) => {
            const item = document.createElement('div');
            item.className = 'bucket-item' + (qr.selected ? ' selected' : '');
            item.onclick = () => toggleBucketSelection(index);
            item.style.cursor = 'pointer';
            
            // Add checkbox
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = qr.selected;
            checkbox.className = 'bucket-item-checkbox';
            checkbox.onclick = (e) => {
                e.stopPropagation();
                toggleBucketSelection(index);
            };
            item.appendChild(checkbox);
            
            // Show QR code
            const img = document.createElement('img');
            img.src = qr.dataURL;
            img.alt = `QR ${index + 1}`;
            
            // If there's a background image, show it too
            if (qr.metadata.artistic && qr.metadata.artistic.backgroundDataURL) {
                const bgThumb = document.createElement('img');
                bgThumb.src = qr.metadata.artistic.backgroundDataURL;
                bgThumb.alt = 'Background';
                bgThumb.style.cssText = 'width: 40px; height: 40px; object-fit: cover; border-radius: 4px; margin-right: 6px; border: 1px solid #ddd;';
                bgThumb.title = 'Background image';
                item.appendChild(bgThumb);
            }
            
            const info = document.createElement('div');
            info.className = 'bucket-item-info';
            
            // Show label or notes if available
            const displayText = qr.metadata.label || qr.metadata.notes || `QR #${index + 1}`;
            info.textContent = displayText.length > 30 ? displayText.substring(0, 27) + '...' : displayText;
            info.title = displayText; // Show full text on hover
            
            const removeBtn = document.createElement('button');
            removeBtn.className = 'bucket-item-remove';
            removeBtn.innerHTML = '×';
            removeBtn.title = 'Remove';
            removeBtn.onclick = () => removeFromBucket(index);
            
            item.appendChild(img);
            item.appendChild(info);
            item.appendChild(removeBtn);
            bucketPreview.appendChild(item);
        });
    } else {
        bucketSection.style.display = 'none';
    }
}

function toggleBucketSelection(index) {
    qrBucket[index].selected = !qrBucket[index].selected;
    updateBucketUI();
}

function removeFromBucket(index) {
    qrBucket.splice(index, 1);
    // Analytics: Track QR removed from bucket
    if (typeof gtag !== 'undefined') {
        gtag('event', 'bucket_qr_removed', {
            'bucket_count': qrBucket.length
        });
    }
    updateBucketUI();
    showNotification('Removed from bucket');
}

function clearBucket() {
    if (qrBucket.length === 0) return;
    
    if (confirm(`Clear all ${qrBucket.length} QR codes from bucket?`)) {
        const previousCount = qrBucket.length;
        qrBucket = [];
        // Analytics: Track bucket cleared
        if (typeof gtag !== 'undefined') {
            gtag('event', 'bucket_cleared', {
                'count': previousCount
            });
        }
        updateBucketUI();
        showNotification('Bucket cleared');
    }
}

// Generate QR Code
generateBtn.addEventListener('click', () => {
    saveCurrentState('Generated QR Code');
    generateQRCode();
});

// Undo/Redo button event listeners
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

// History dropdown toggle
historyDropdownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasHidden = historyDropdown.classList.contains('hidden');
    historyDropdown.classList.toggle('hidden');
    // Analytics: Track dropdown open
    if (typeof gtag !== 'undefined' && wasHidden) {
        gtag('event', 'history_dropdown_opened', {
            'history_count': stateHistory.length,
            'current_position': `${currentStateIndex + 1}/${stateHistory.length}`
        });
    }
});

// Clear history button
clearHistoryBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearHistory();
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!historyDropdown.classList.contains('hidden') && 
        !historyDropdown.contains(e.target) && 
        e.target !== historyDropdownBtn) {
        historyDropdown.classList.add('hidden');
    }
});

// Keyboard shortcuts for undo/redo
document.addEventListener('keydown', (e) => {
    // Escape to close history dropdown
    if (e.key === 'Escape' && !historyDropdown.classList.contains('hidden')) {
        historyDropdown.classList.add('hidden');
        return;
    }
    
    // Ctrl+Z or Cmd+Z for undo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        // Analytics: Track keyboard undo
        if (typeof gtag !== 'undefined' && currentStateIndex > 0) {
            gtag('event', 'history_keyboard_undo');
        }
        undo();
    }
    // Ctrl+Y or Ctrl+Shift+Z or Cmd+Shift+Z for redo
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        // Analytics: Track keyboard redo
        if (typeof gtag !== 'undefined' && currentStateIndex < stateHistory.length - 1) {
            gtag('event', 'history_keyboard_redo');
        }
        redo();
    }
});

function generateQRCode() {
    window.multiQRPairs = undefined;
    const text = textInput.value.trim();
    if (!text) {
        alert('Please enter some text or URL!');
        return;
    }

    // Check for multi-pair mode: first line is name,url
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length > 1 && lines[0].toLowerCase() === 'name,url') {
        // Parse all lines after the header as label,url pairs
        const pairs = [];
        for (let i = 1; i < lines.length; i++) {
            const [label, url] = lines[i].split(/,(.+)/); // split on first comma only
            if (label && url) {
                pairs.push({ label: label.trim(), url: url.trim() });
            }
        }
        if (pairs.length > 0) {
            showMultiQRPreview(pairs);
            return;
        }
    }

    // Single QR code fallback (original logic)
    // Validate contrast
    const contrastCheck = validateContrast(currentDarkColor, currentLightColor);
    if (!contrastCheck.valid) {
        alert(`⚠️ Color Contrast Too Low!\n\nThe colors you selected don't have enough contrast for QR codes to scan reliably.\n\nContrast ratio: ${contrastCheck.ratio}:1 (minimum: 3.0:1)\n\nPlease choose colors with more contrast:\n• Dark QR code on light background\n• Light QR code on dark background\n• Use the color presets for safe combinations`);
        return;
    }
    
    // Check which mode is selected
    const selectedMode = document.querySelector('input[name="qrMode"]:checked')?.value || 'standard';
    
    if (selectedMode === 'artistic') {
        // Use artistic QR generation
        generateArtisticMode(text);
    } else {
        // Use standard QR generation (original QRCode.js)
        generateStandardMode(text);
    }
}

// Standard QR generation (original QRCode.js logic)
function generateStandardMode(text) {
    try {
        qrCanvas.getContext('2d').clearRect(0, 0, qrCanvas.width, qrCanvas.height);
        const size = parseInt(sizeRange.value);
        const border = parseInt(borderRange.value);
        const qrSize = size * 32;
        const tempDiv = document.createElement('div');
        tempDiv.style.display = 'none';
        document.body.appendChild(tempDiv);
        const qr = new QRCode(tempDiv, {
            text: text,
            width: qrSize,
            height: qrSize,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel[currentErrorCorrectionLevel]
        });
        setTimeout(() => {
            const qrCanvas = tempDiv.querySelector('canvas');
            const qrImage = tempDiv.querySelector('img');
            if (qrCanvas) {
                drawQRWithLogoFromCanvas(qrCanvas, qrSize);
                document.body.removeChild(tempDiv);
            } else if (qrImage && qrImage.complete) {
                drawQRWithLogo(qrImage, qrSize);
                document.body.removeChild(tempDiv);
            } else if (qrImage) {
                qrImage.onload = () => {
                    drawQRWithLogo(qrImage, qrSize);
                    document.body.removeChild(tempDiv);
                };
            } else {
                console.error('No QR canvas or image generated!');
                document.body.removeChild(tempDiv);
            }
        }, 100);
    } catch (error) {
        alert('Failed to generate QR code: ' + error.message);
        console.error(error);
    }
}

// Artistic QR generation wrapper
function generateArtisticMode(text) {
    try {
        qrCanvas.getContext('2d').clearRect(0, 0, qrCanvas.width, qrCanvas.height);
        const size = parseInt(sizeRange.value);
        const qrSize = size * 32;
        
        generateArtisticQR(text, qrSize).then(artisticCanvas => {
            // Draw the artistic QR with logo and label
            drawQRWithLogoFromCanvas(artisticCanvas, qrSize);
        }).catch(error => {
            alert('Failed to generate artistic QR code: ' + error.message);
            console.error(error);
        });
    } catch (error) {
        alert('Failed to generate artistic QR code: ' + error.message);
        console.error(error);
    }
}

// --- Multi-QR Preview Logic ---
function showMultiQRPreview(pairs) {
    window.multiQRPairs = pairs
    // Remove any previous preview container
    let multiPreview = document.getElementById('multiQRPreview');
    if (multiPreview) multiPreview.remove();

    // Create a new preview container
    multiPreview = document.createElement('div');
    multiPreview.id = 'multiQRPreview';
    multiPreview.style.display = 'flex';
    multiPreview.style.flexWrap = 'wrap';
    multiPreview.style.gap = '24px';
    multiPreview.style.margin = '24px 0';
    multiPreview.style.justifyContent = 'center';

    // Insert before the main QR preview
    const previewContainer = document.querySelector('.preview-container');
    if (previewContainer) previewContainer.insertBefore(multiPreview, previewContainer.firstChild);

    // For each pair, generate a QR and label
    pairs.forEach((pair, idx) => {
        const qrDiv = document.createElement('div');
        qrDiv.style.display = 'flex';
        qrDiv.style.flexDirection = 'column';
        qrDiv.style.alignItems = 'center';
        qrDiv.style.margin = '8px';

        const qrCanvas = document.createElement('canvas');
        const size = parseInt(sizeRange.value);
        const border = parseInt(borderRange.value);
        const qrSize = size * 32;
        qrCanvas.width = qrSize + (border * 8);
        qrCanvas.height = qrSize + (border * 8) + 40;

        // Generate QR code for this pair
        const tempDiv = document.createElement('div');
        tempDiv.style.display = 'none';
        document.body.appendChild(tempDiv);
        const qr = new QRCode(tempDiv, {
            text: pair.url,
            width: qrSize,
            height: qrSize,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel[currentErrorCorrectionLevel]
        });
        setTimeout(() => {
            const qrImg = tempDiv.querySelector('canvas') || tempDiv.querySelector('img');
            if (qrImg) {
                const ctx = qrCanvas.getContext('2d');
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, qrCanvas.width, qrCanvas.height);
                ctx.drawImage(qrImg, border * 4, border * 4, qrSize, qrSize);
                // Draw label
                ctx.fillStyle = currentLabelColor;
                ctx.font = 'bold 18px Arial, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText(pair.label, qrCanvas.width / 2, qrSize + border * 4 + 8);
            }
            document.body.removeChild(tempDiv);
        }, 100);

        qrDiv.appendChild(qrCanvas);
        const label = document.createElement('div');
        label.textContent = pair.label;
        label.style.marginTop = '8px';
        label.style.fontWeight = 'bold';
        qrDiv.appendChild(label);
        multiPreview.appendChild(qrDiv);
    });

    // Add controls for bucket and PDF
    let controls = document.getElementById('multiQRControls');
    if (controls) controls.remove();
    controls = document.createElement('div');
    controls.id = 'multiQRControls';
    controls.style.display = 'flex';
    controls.style.justifyContent = 'center';
    controls.style.gap = '16px';
    controls.style.margin = '16px 0 32px 0';

    const addAllBtn = document.createElement('button');
    addAllBtn.textContent = 'Add All to Bucket';
    addAllBtn.className = 'btn btn-bucket';
    addAllBtn.onclick = function() { addAllMultiQRToBucket(pairs); };
    controls.appendChild(addAllBtn);

    const pdfBtn = document.createElement('button');
    pdfBtn.textContent = 'Download All as PDF';
    pdfBtn.className = 'btn btn-download';
    pdfBtn.onclick = function() { downloadMultiQRAsPDF(pairs); };
    controls.appendChild(pdfBtn);

    if (previewContainer) previewContainer.insertBefore(controls, multiPreview.nextSibling);
}

function addAllMultiQRToBucket(pairs) {
    // Add each QR to the bucket (if not full)
    let added = 0;
    pairs.forEach(pair => {
        if (qrBucket.length < MAX_BUCKET_SIZE_OTHER) {
            qrBucket.push({
                text: pair.url,
                label: pair.label,
                darkColor: currentDarkColor,
                lightColor: currentLightColor,
                labelColor: currentLabelColor,
                style: currentQRStyle
            });
            added++;
        }
    });
    updateBucketUI();
    showNotification(`${added} QR code${added !== 1 ? 's' : ''} added to bucket.`);
}

function downloadMultiQRAsPDF(pairs) {
    // Use jsPDF to create a PDF with all QR codes and labels, paginated
    const size = parseInt(sizeRange.value);
    const doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const margin = 32;
    const gap = 24;
    const cols = 2;
    const rows = 4; // fixed rows per page
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const cellW = (pageWidth - margin * 2 - gap * (cols - 1)) / cols;
    const cellH = (pageHeight - margin * 2 - gap * (rows - 1)) / rows;
    const qrMaxSize = Math.min(cellW, cellH - 32); // leave space for label
    let total = pairs.length;
    function processQR(idx) {
        if (idx >= total) {
            doc.save('qr-codes.pdf');
            return;
        }
        const pair = pairs[idx];
        const tempDiv = document.createElement('div');
        tempDiv.style.display = 'none';
        document.body.appendChild(tempDiv);
        const qr = new QRCode(tempDiv, {
            text: pair.url,
            width: qrMaxSize,
            height: qrMaxSize,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel[currentErrorCorrectionLevel]
        });
        setTimeout(() => {
            const qrImg = tempDiv.querySelector('canvas') || tempDiv.querySelector('img');
            if (qrImg) {
                const qrDataUrl = qrImg.toDataURL ? qrImg.toDataURL('image/png') : qrImg.src;
                const indexOnPage = idx % (cols * rows);
                const col = indexOnPage % cols;
                const row = Math.floor(indexOnPage / cols);
                // Center QR in cell
                const cellX = margin + col * (cellW + gap);
                const cellY = margin + row * (cellH + gap);
                const qrX = cellX + (cellW - qrMaxSize) / 2;
                const qrY = cellY;
                if (idx > 0 && indexOnPage === 0) {
                    doc.addPage();
                }
                doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrMaxSize, qrMaxSize);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(14);
                // Center label below QR
                doc.text(pair.label, cellX + cellW / 2, qrY + qrMaxSize + 20, { align: 'center' });
            }
            document.body.removeChild(tempDiv);
            processQR(idx + 1);
        }, 100);
    }
    processQR(0);
}

// --- Artistic QR Code Generation (using qr-code-styling) ---
function generateArtisticQR(text, qrSize) {
    return new Promise((resolve, reject) => {
        try {
            // Get artistic mode settings from UI controls
            const dotStyle = document.getElementById('dotStyle')?.value || 'rounded';
            const cornerSquareStyle = document.getElementById('cornerSquareStyle')?.value || 'extra-rounded';
            const cornerDotStyle = document.getElementById('cornerDotStyle')?.value || 'dot';
            const enableGradient = document.getElementById('enableGradient')?.checked || false;
            const gradientRotation = parseInt(document.getElementById('gradientRotation')?.value || '45');
            
            // Create gradient for artistic effect (if enabled)
            const dotsColor = enableGradient ? {
                type: 'linear',
                rotation: (gradientRotation * Math.PI) / 180, // Convert degrees to radians
                colorStops: [
                    { offset: 0, color: currentDarkColor },
                    { offset: 1, color: adjustColorBrightness(currentDarkColor, 20) }
                ]
            } : currentDarkColor;
            
            // Configure qr-code-styling options
            const qrCode = new QRCodeStyling({
                width: qrSize,
                height: qrSize,
                data: text,
                margin: 0,
                qrOptions: {
                    typeNumber: 0,
                    mode: 'Byte',
                    errorCorrectionLevel: currentErrorCorrectionLevel
                },
                imageOptions: {
                    hideBackgroundDots: true,
                    imageSize: 0.4,
                    margin: 10
                },
                dotsOptions: {
                    type: dotStyle,
                    ...(enableGradient ? { gradient: dotsColor } : { color: dotsColor })
                },
                backgroundOptions: {
                    color: currentLightColor
                },
                cornersSquareOptions: {
                    type: cornerSquareStyle,
                    color: currentDarkColor
                },
                cornersDotOptions: {
                    type: cornerDotStyle,
                    color: currentDarkColor
                }
            });
            
            // If logo is selected, add it
            if (window.uploadedLogoDataURL) {
                qrCode.update({
                    image: window.uploadedLogoDataURL,
                    imageOptions: {
                        hideBackgroundDots: true,
                        imageSize: parseInt(logoSizeRange.value) / 100,
                        margin: 10
                    }
                });
            }
            
            // Generate canvas and return it
            qrCode.getRawData('png').then(blob => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = qrSize;
                        canvas.height = qrSize;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        resolve(canvas);
                    };
                    img.src = reader.result;
                };
                reader.readAsDataURL(blob);
            }).catch(reject);
        } catch (error) {
            reject(error);
        }
    });
}

// Helper function to adjust color brightness for gradients
function adjustColorBrightness(hex, percent) {
    // Remove # if present
    hex = hex.replace('#', '');
    
    // Convert to RGB
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);
    
    // Adjust brightness
    r = Math.min(255, Math.max(0, r + (r * percent / 100)));
    g = Math.min(255, Math.max(0, g + (g * percent / 100)));
    b = Math.min(255, Math.max(0, b + (b * percent / 100)));
    
    // Convert back to hex
    const rr = Math.round(r).toString(16).padStart(2, '0');
    const gg = Math.round(g).toString(16).padStart(2, '0');
    const bb = Math.round(b).toString(16).padStart(2, '0');
    
    return '#' + rr + gg + bb;
}

function drawQRWithLogo(qrImage, qrSize) {
    const label = labelInput.value.trim();
    const border = parseInt(borderRange.value);
    const quietZone = border * 4; // Convert border value to pixels (1-10 -> 4-40px)
    const padding = 20 + quietZone; // Base padding + quiet zone
    
    // Calculate dynamic label height based on font size
    let labelHeight = 0;
    if (label) {
        const labelSizePercent = parseInt(labelSizeRange.value) / 100;
        const baseFontSize = 20;
        const fontSize = Math.floor(baseFontSize * labelSizePercent);
        const lineHeight = fontSize * 1.2;
        // Gap scales with both font size and QR size for consistent visual separation
        const labelGap = Math.max(15, fontSize * 0.5, qrSize * 0.02); // Min 15px or 2% of QR size
        
        // Estimate number of lines (rough calculation)
        const maxWidth = qrSize;
        const avgCharWidth = fontSize * 0.5;
        const estimatedCharsPerLine = Math.floor(maxWidth / avgCharWidth);
        const estimatedLines = Math.ceil(label.length / estimatedCharsPerLine);
        
        labelHeight = labelGap + (lineHeight * estimatedLines) + 20; // Add some bottom padding
    }
    
    // Set canvas size to include label space
    qrCanvas.width = qrSize + (padding * 2);
    qrCanvas.height = qrSize + (padding * 2) + labelHeight;
    
    const ctx = qrCanvas.getContext('2d');
    
    // Fill white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, qrCanvas.width, qrCanvas.height);
    
    // Disable image smoothing for crisp pixels (important for QR codes)
    ctx.imageSmoothingEnabled = false;
    ctx.mozImageSmoothingEnabled = false;
    ctx.webkitImageSmoothingEnabled = false;
    ctx.msImageSmoothingEnabled = false;
    
    // Draw QR code with padding
    ctx.drawImage(qrImage, padding, padding, qrSize, qrSize);
    
    // Recolor QR code if custom colors are used
    if (currentDarkColor !== '#000000' || currentLightColor !== '#ffffff') {
        const fullImageData = ctx.getImageData(padding, padding, qrSize, qrSize);
        const pixels = fullImageData.data;
        
        // Parse custom colors
        const darkRGB = hexToRgb(currentDarkColor);
        const lightRGB = hexToRgb(currentLightColor);
        
        // Recolor: black -> dark color, white -> light color
        for (let i = 0; i < pixels.length; i += 4) {
            const brightness = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
            if (brightness < 128) {
                // Dark pixel - replace with custom dark color
                pixels[i] = darkRGB.r;
                pixels[i + 1] = darkRGB.g;
                pixels[i + 2] = darkRGB.b;
            } else {
                // Light pixel - replace with custom light color
                pixels[i] = lightRGB.r;
                pixels[i + 1] = lightRGB.g;
                pixels[i + 2] = lightRGB.b;
            }
        }
        
        ctx.putImageData(fullImageData, padding, padding);
    }

    // Apply QR code style (dots or rounded)
    if (currentQRStyle !== 'squares') {
        applyQRStyle(ctx, qrSize, padding, padding);
    }
    
    // Add logo if selected
    if (selectedLogo) {
        const logoSizePercent = parseInt(logoSizeRange.value) / 100;
        const logoSize = Math.floor(qrSize * logoSizePercent);
        const logoPos = padding + (qrSize - logoSize) / 2;
        
        // Draw background for logo (use light color)
        const logoPadding = 10;
        ctx.fillStyle = currentLightColor;
        ctx.fillRect(
            logoPos - logoPadding,
            logoPos - logoPadding,
            logoSize + logoPadding * 2,
            logoSize + logoPadding * 2
        );
        
        // Draw logo
        ctx.drawImage(selectedLogo, logoPos, logoPos, logoSize, logoSize);
    }
    
    // Show canvas and hide placeholder
    qrCanvas.classList.add('visible');
    previewPlaceholder.classList.add('hidden');
    
    // Apply artistic background blending if available (BEFORE label)
    if (backgroundImage) {
        applyArtisticBlending(ctx, qrCanvas.width, qrCanvas.height, padding, qrSize);
    }
    
    // Draw label AFTER blending so it stays visible and unaffected
    if (label) {
        const labelSizePercent = parseInt(labelSizeRange.value) / 100;
        const baseFontSize = 20;
        const fontSize = Math.floor(baseFontSize * labelSizePercent);
        // Gap scales with both font size and QR size for consistent visual separation
        const labelGap = Math.max(15, fontSize * 0.5, qrSize * 0.02); // Min 15px or 2% of QR size
        
        ctx.font = `bold ${fontSize}px Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        
        const maxWidth = qrSize;
        const startY = qrSize + padding + labelGap;
        
        // Use Google colors if enabled and in Google Review mode
        if (isGoogleReviewMode && useGoogleColorsInLabel) {
            drawGoogleColoredText(ctx, label, qrCanvas.width / 2, startY, maxWidth);
        } else {
            // Normal label drawing with single color
            ctx.fillStyle = currentLabelColor;
            
            // Wrap text if too long (max width is QR code width)
            const words = label.split(' ');
            let line = '';
            let y = startY;
            
            for (let i = 0; i < words.length; i++) {
                const testLine = line + words[i] + ' ';
                const metrics = ctx.measureText(testLine);
                
                if (metrics.width > maxWidth && i > 0) {
                    ctx.fillText(line, qrCanvas.width / 2, y);
                    line = words[i] + ' ';
                    y += fontSize * 1.2;
                } else {
                    line = testLine;
                }
            }
            ctx.fillText(line, qrCanvas.width / 2, y);
        }
    }
    
    // Store the data URL for download
    currentQRDataURL = qrCanvas.toDataURL('image/png');
    
    // Validate QR code scannability if artistic mode is active
    if (backgroundImage) {
        validateQRScannability();
    }
    
    // Enable "Add to Bucket" button
    addToBucketBtn.disabled = false;
    
    // Update analytics
    updateAnalytics(qrSize);
    
    // Track event in Google Analytics
    if (typeof gtag !== 'undefined') {
        gtag('event', 'qr_generated', {
            'qr_style': currentQRStyle,
            'has_logo': selectedLogo ? 'yes' : 'no',
            'logo_size': selectedLogo ? logoSizeRange.value : 0,
            'qr_size': size
        });
    }
    
    // Show success message
    showNotification('QR Code generated successfully!');
}

function drawQRWithLogoFromCanvas(sourceCanvas, qrSize) {
    const label = labelInput.value.trim();
    const border = parseInt(borderRange.value);
    const quietZone = border * 4; // Convert border value to pixels (1-10 -> 4-40px)
    const padding = 20 + quietZone; // Base padding + quiet zone
    
    // Calculate dynamic label height based on font size
    let labelHeight = 0;
    if (label) {
        const labelSizePercent = parseInt(labelSizeRange.value) / 100;
        const baseFontSize = 20;
        const fontSize = Math.floor(baseFontSize * labelSizePercent);
        const lineHeight = fontSize * 1.2;
        // Gap scales with both font size and QR size for consistent visual separation
        const labelGap = Math.max(15, fontSize * 0.5, qrSize * 0.02); // Min 15px or 2% of QR size
        
        // Estimate number of lines (rough calculation)
        const maxWidth = qrSize;
        const avgCharWidth = fontSize * 0.5;
        const estimatedCharsPerLine = Math.floor(maxWidth / avgCharWidth);
        const estimatedLines = Math.ceil(label.length / estimatedCharsPerLine);
        
        labelHeight = labelGap + (lineHeight * estimatedLines) + 20; // Add some bottom padding
    }
    
    // Set canvas size to include label space
    qrCanvas.width = qrSize + (padding * 2);
    qrCanvas.height = qrSize + (padding * 2) + labelHeight;
    
    const ctx = qrCanvas.getContext('2d');
    
    // Disable image smoothing for crisp pixels
    ctx.imageSmoothingEnabled = false;
    ctx.mozImageSmoothingEnabled = false;
    ctx.webkitImageSmoothingEnabled = false;
    ctx.msImageSmoothingEnabled = false;
    
    // Fill entire canvas with white background first
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, qrCanvas.width, qrCanvas.height);
    
    // Get source image data
    const sourceCtx = sourceCanvas.getContext('2d');
    const sourceData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    const sourcePixels = sourceData.data;
    
    // Parse custom colors
    const darkRGB = hexToRgb(currentDarkColor);
    const lightRGB = hexToRgb(currentLightColor);
    
    // Create new image data for QR code area
    const newData = ctx.createImageData(qrSize, qrSize);
    const newPixels = newData.data;
    
    // Copy and recolor pixels
    const scaleX = sourceCanvas.width / qrSize;
    const scaleY = sourceCanvas.height / qrSize;
    
    for (let y = 0; y < qrSize; y++) {
        for (let x = 0; x < qrSize; x++) {
            const sourceX = Math.floor(x * scaleX);
            const sourceY = Math.floor(y * scaleY);
            const sourceIndex = (sourceY * sourceCanvas.width + sourceX) * 4;
            const targetIndex = (y * qrSize + x) * 4;
            
            const brightness = (sourcePixels[sourceIndex] + sourcePixels[sourceIndex + 1] + sourcePixels[sourceIndex + 2]) / 3;
            
            if (brightness < 128) {
                // Dark pixel
                newPixels[targetIndex] = darkRGB.r;
                newPixels[targetIndex + 1] = darkRGB.g;
                newPixels[targetIndex + 2] = darkRGB.b;
                newPixels[targetIndex + 3] = 255;
            } else {
                // Light pixel
                newPixels[targetIndex] = lightRGB.r;
                newPixels[targetIndex + 1] = lightRGB.g;
                newPixels[targetIndex + 2] = lightRGB.b;
                newPixels[targetIndex + 3] = 255;
            }
        }
    }
    
    ctx.putImageData(newData, padding, padding);
    
    // Apply QR code style (dots or rounded)
    if (currentQRStyle !== 'squares') {
        applyQRStyle(ctx, qrSize, padding, padding);
    }
    
    // Add logo if selected
    if (selectedLogo) {
        const logoSizePercent = parseInt(logoSizeRange.value) / 100;
        const logoSize = Math.floor(qrSize * logoSizePercent);
        const logoPos = padding + (qrSize - logoSize) / 2;
        
        // Draw background for logo (use light color)
        const logoPadding = 10;
        ctx.fillStyle = currentLightColor;
        ctx.fillRect(
            logoPos - logoPadding,
            logoPos - logoPadding,
            logoSize + logoPadding * 2,
            logoSize + logoPadding * 2
        );
        
        // Draw logo
        ctx.drawImage(selectedLogo, logoPos, logoPos, logoSize, logoSize);
    }
    
    // Draw label if present
    if (label) {
        const labelSizePercent = parseInt(labelSizeRange.value) / 100;
        const baseFontSize = 20;
        const fontSize = Math.floor(baseFontSize * labelSizePercent);
        // Gap scales with both font size and QR size for consistent visual separation
        const labelGap = Math.max(15, fontSize * 0.5, qrSize * 0.02); // Min 15px or 2% of QR size
        
        ctx.font = `bold ${fontSize}px Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top'; // Changed to 'top' for better positioning
        
        const maxWidth = qrSize;
        const startY = qrSize + padding + labelGap;
        
        // Use Google colors if enabled and in Google Review mode
        if (isGoogleReviewMode && useGoogleColorsInLabel) {
            drawGoogleColoredText(ctx, label, qrCanvas.width / 2, startY, maxWidth);
        } else {
            // Normal label drawing with single color
            ctx.fillStyle = currentLabelColor;
            
            // Wrap text if too long (max width is QR code width)
            const words = label.split(' ');
            let line = '';
            let y = startY;
            
            for (let i = 0; i < words.length; i++) {
                const testLine = line + words[i] + ' ';
                const metrics = ctx.measureText(testLine);
                
                if (metrics.width > maxWidth && i > 0) {
                    ctx.fillText(line, qrCanvas.width / 2, y);
                    line = words[i] + ' ';
                    y += fontSize * 1.2;
                } else {
                    line = testLine;
                }
            }
            ctx.fillText(line, qrCanvas.width / 2, y);
        }
    }
    
    // Show canvas and hide placeholder
    qrCanvas.classList.add('visible');
    previewPlaceholder.classList.add('hidden');
    
    // Apply artistic background blending if available (BEFORE re-drawing label)
    if (backgroundImage) {
        applyArtisticBlending(ctx, qrCanvas.width, qrCanvas.height, padding, qrSize);
        
        // Re-draw label AFTER blending to keep it visible
        if (label) {
            const labelSizePercent = parseInt(labelSizeRange.value) / 100;
            const baseFontSize = 20;
            const fontSize = Math.floor(baseFontSize * labelSizePercent);
            const labelGap = Math.max(15, fontSize * 0.5, qrSize * 0.02);
            
            ctx.font = `bold ${fontSize}px Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            
            const maxWidth = qrSize;
            const startY = qrSize + padding + labelGap;
            
            // Use Google colors if enabled and in Google Review mode
            if (isGoogleReviewMode && useGoogleColorsInLabel) {
                drawGoogleColoredText(ctx, label, qrCanvas.width / 2, startY, maxWidth);
            } else {
                // Normal label drawing with single color
                ctx.fillStyle = currentLabelColor;
                
                const words = label.split(' ');
                let line = '';
                let y = startY;
                
                for (let i = 0; i < words.length; i++) {
                    const testLine = line + words[i] + ' ';
                    const metrics = ctx.measureText(testLine);
                    
                    if (metrics.width > maxWidth && i > 0) {
                        ctx.fillText(line, qrCanvas.width / 2, y);
                        line = words[i] + ' ';
                        y += fontSize * 1.2;
                    } else {
                        line = testLine;
                    }
                }
                ctx.fillText(line, qrCanvas.width / 2, y);
            }
        }
    }
    
    // Store the data URL for download
    currentQRDataURL = qrCanvas.toDataURL('image/png');
    
    // Validate QR code scannability if artistic mode is active
    if (backgroundImage) {
        validateQRScannability();
    }
    
    // Enable "Add to Bucket" button
    addToBucketBtn.disabled = false;
    
    // Update analytics
    updateAnalytics(qrSize);
    
    // Track event in Google Analytics
    if (typeof gtag !== 'undefined') {
        gtag('event', 'qr_generated', {
            'qr_style': currentQRStyle,
            'has_logo': selectedLogo ? 'yes' : 'no',
            'logo_size': selectedLogo ? logoSizeRange.value : 0,
            'qr_size': parseInt(sizeRange.value)
        });
    }
    
    // Show success message
    showNotification('QR Code generated successfully!');
}

// Update analytics preview
function updateAnalytics(qrSize) {
    const text = textInput.value.trim();
    const textLength = text.length;
    
    // Estimate QR version based on data length and error correction
    // Version ranges: 1 (21x21) to 40 (177x177)
    let version = 1;
    const capacities = [17, 32, 53, 78, 106, 134, 154, 192, 230, 271]; // Approximate for High EC
    for (let i = 0; i < capacities.length; i++) {
        if (textLength <= capacities[i]) {
            version = i + 1;
            break;
        }
    }
    if (textLength > capacities[capacities.length - 1]) {
        version = Math.min(40, Math.ceil(textLength / 100) + 10);
    }
    
    // Calculate modules (dots in QR code)
    const modules = 21 + (version - 1) * 4;
    
    // Calculate minimum print size (2.5mm per module minimum for scanning)
    const minSizeMM = Math.ceil(modules * 2.5);
    const minSizeInch = (minSizeMM / 25.4).toFixed(1);
    
    // Estimate data capacity remaining
    const maxCapacity = version <= 10 ? capacities[version - 1] : Math.floor(version * 100);
    const usedPercent = Math.round((textLength / maxCapacity) * 100);
    
    // Get contrast ratio
    const contrastCheck = validateContrast(currentDarkColor, currentLightColor);
    
    // Dynamic error correction level display
    const errorCorrectionLabels = {
        'L': 'Low (7%)',
        'M': 'Medium (15%)',
        'Q': 'Quality (25%)',
        'H': 'High (30%)'
    };
    
    // Update UI
    document.getElementById('qrVersion').textContent = version;
    document.getElementById('qrModules').textContent = `${modules}×${modules}`;
    document.getElementById('qrMinSize').textContent = `${minSizeMM}mm (${minSizeInch}\")`;
    document.getElementById('qrErrorLevel').textContent = errorCorrectionLabels[currentErrorCorrectionLevel] || 'High (30%)';
    
    const capacityEl = document.getElementById('qrDataCapacity');
    capacityEl.textContent = `${usedPercent}% used`;
    capacityEl.className = 'analytics-value';
    if (usedPercent < 70) capacityEl.classList.add('good');
    else if (usedPercent < 90) capacityEl.classList.add('warning');
    else capacityEl.classList.add('error');
    
    const contrastEl = document.getElementById('qrContrast');
    contrastEl.textContent = `${contrastCheck.ratio}:1`;
    contrastEl.className = 'analytics-value';
    if (contrastCheck.ratio >= 7) contrastEl.classList.add('good');
    else if (contrastCheck.ratio >= 4.5) contrastEl.classList.add('warning');
    else contrastEl.classList.add('error');    
    // Calculate and display quality score
    calculateQualityScore(contrastCheck.ratio, usedPercent, qrSize);
}

// Compute analytics object (same logic as updateAnalytics but returns values)
function computeAnalytics(qrSize) {
    const text = textInput.value.trim();
    const textLength = text.length;
    let version = 1;
    const capacities = [17, 32, 53, 78, 106, 134, 154, 192, 230, 271];
    for (let i = 0; i < capacities.length; i++) {
        if (textLength <= capacities[i]) {
            version = i + 1;
            break;
        }
    }
    if (textLength > capacities[capacities.length - 1]) {
        version = Math.min(40, Math.ceil(textLength / 100) + 10);
    }
    const modules = 21 + (version - 1) * 4;
    const minSizeMM = Math.ceil(modules * 2.5);
    const minSizeInch = (minSizeMM / 25.4).toFixed(1);
    const maxCapacity = version <= 10 ? capacities[version - 1] : Math.floor(version * 100);
    const usedPercent = Math.round((textLength / maxCapacity) * 100);
    const contrastCheck = validateContrast(currentDarkColor, currentLightColor);
    
    // Dynamic error correction level display
    const errorCorrectionLabels = {
        'L': 'Low (7%)',
        'M': 'Medium (15%)',
        'Q': 'Quality (25%)',
        'H': 'High (30%)'
    };

    return {
        version,
        modules,
        minSizeMM,
        minSizeInch,
        usedPercent,
        contrastRatio: contrastCheck.ratio,
        errorCorrection: errorCorrectionLabels[currentErrorCorrectionLevel] || 'High (30%)'
    };
}

// Calculate Quality Score
function calculateQualityScore(contrastRatio, dataUsage, qrSize) {
    let score = 0;
    const recommendations = [];
    
    // Check if artistic mode is active
    const isArtisticMode = backgroundImage !== null;
    
    // 1. Contrast Ratio (30 points)
    if (contrastRatio >= 21) {
        score += 30;
    } else if (contrastRatio >= 7) {
        score += 25;
        recommendations.push({
            type: 'info',
            icon: 'ℹ️',
            text: 'Good contrast! Consider darker colors for even better scanning.',
            action: null
        });
    } else if (contrastRatio >= 4.5) {
        score += 20;
        recommendations.push({
            type: 'warning',
            icon: '⚠️',
            text: 'Contrast is acceptable but could be improved. Try ',
            actionText: 'switching to black on white',
            action: () => applyColorPreset('#000000', '#ffffff')
        });
    } else if (contrastRatio >= 3) {
        score += 10;
        recommendations.push({
            type: 'warning',
            icon: '⚠️',
            text: 'Low contrast may affect scanning. Click to ',
            actionText: 'use high contrast colors',
            action: () => applyColorPreset('#000000', '#ffffff')
        });
    } else {
        score += 0;
        recommendations.push({
            type: 'warning',
            icon: '❌',
            text: 'Contrast too low! QR code may not scan. ',
            actionText: 'Fix contrast now',
            action: () => applyColorPreset('#000000', '#ffffff')
        });
    }
    
    // 2. Data Capacity (25 points)
    if (dataUsage < 50) {
        score += 25;
    } else if (dataUsage < 70) {
        score += 20;
    } else if (dataUsage < 85) {
        score += 15;
        recommendations.push({
            type: 'info',
            icon: 'ℹ️',
            text: 'QR code is getting full. Consider using a URL shortener for longer links.',
            action: null
        });
    } else if (dataUsage < 95) {
        score += 10;
        recommendations.push({
            type: 'warning',
            icon: '⚠️',
            text: 'QR code is very full. Less room for logo and error correction. Use a shorter URL.',
            action: null
        });
    } else {
        score += 5;
        recommendations.push({
            type: 'warning',
            icon: '❌',
            text: 'QR code is almost at capacity! Scanning may be unreliable. Shorten your text.',
            action: null
        });
    }
    
    // 3. Logo Size (20 points)
    const logoSize = selectedLogo ? parseInt(logoSizeRange.value) : 0;
    if (!selectedLogo) {
        score += 20;
    } else if (logoSize >= 15 && logoSize <= 25) {
        score += 20;
    } else if ((logoSize >= 10 && logoSize < 15) || (logoSize > 25 && logoSize <= 30)) {
        score += 15;
    } else if (logoSize > 30 && logoSize <= 35) {
        score += 10;
        recommendations.push({
            type: 'warning',
            icon: '⚠️',
            text: `Logo is ${logoSize}% of QR code. `,
            actionText: 'Reduce to 25% for better reliability',
            action: () => {
                logoSizeRange.value = 25;
                logoSizeValue.textContent = '25';
                saveCurrentState('Reduced logo size to 25% (quality score)');
                generateQRCode();
            }
        });
    } else if (logoSize > 35) {
        score += 5;
        recommendations.push({
            type: 'warning',
            icon: '❌',
            text: `Logo covers ${logoSize}% of code! `,
            actionText: 'Reduce to 25% now',
            action: () => {
                logoSizeRange.value = 25;
                logoSizeValue.textContent = '25';
                generateQRCode();
            }
        });
    }
    
    // 4. Print Size (15 points) - Smart sizing based on complexity
    const currentSize = parseInt(sizeRange.value);
    const printSizeMM = Math.ceil(qrSize / 10); // Rough estimate
    
    // Calculate optimal size based on QR complexity
    let optimalSize = 10; // Base minimum
    
    // Adjust for data usage
    if (dataUsage > 85) {
        optimalSize = Math.max(optimalSize, 18);
    } else if (dataUsage > 70) {
        optimalSize = Math.max(optimalSize, 15);
    } else if (dataUsage > 50) {
        optimalSize = Math.max(optimalSize, 12);
    }
    
    // Adjust for logo
    if (selectedLogo) {
        optimalSize = Math.max(optimalSize, 15);
        if (logoSize > 25) {
            optimalSize = Math.max(optimalSize, 18);
        }
    }
    
    // Adjust for artistic mode
    if (isArtisticMode) {
        optimalSize = Math.max(optimalSize, 18); // Artistic QR needs to be larger
    }
    
    // Adjust for style
    if (currentQRStyle === 'dots') {
        optimalSize = Math.max(optimalSize, 15); // Dots need more clarity
    }
    
    // Score and recommend based on actual size vs optimal
    if (printSizeMM > 100) {
        score += 15;
    } else if (printSizeMM >= 50) {
        score += 12;
    } else if (printSizeMM >= 30) {
        score += 8;
        
        // Check if below optimal
        if (currentSize < optimalSize) {
            const reasons = [];
            if (dataUsage > 70) reasons.push('high data usage');
            if (logoSize > 25) reasons.push('large logo');
            if (isArtisticMode) reasons.push('artistic background');
            if (currentQRStyle === 'dots') reasons.push('dots style');
            
            if (reasons.length > 0) {
                recommendations.push({
                    type: 'info',
                    icon: '📏',
                    text: `Size ${currentSize} is below optimal due to ${reasons.join(', ')}. `,
                    actionText: `Increase to ${optimalSize} for better scanning`,
                    action: () => {
                        sizeRange.value = optimalSize;
                        sizeValue.textContent = optimalSize;
                        saveCurrentState(`Optimized size to ${optimalSize}`);
                        generateQRCode();
                        
                        if (typeof gtag !== 'undefined') {
                            gtag('event', 'size_optimized', {
                                'from': currentSize,
                                'to': optimalSize,
                                'source': 'quality_score_recommendation'
                            });
                        }
                    }
                });
            }
        }
    } else {
        score += 3;
        
        // Small size - strong recommendation
        const reasons = [];
        if (dataUsage > 70) reasons.push('complex data');
        if (selectedLogo) reasons.push('logo present');
        if (isArtisticMode) reasons.push('artistic mode');
        
        const reasonText = reasons.length > 0 ? ` (${reasons.join(', ')})` : '';
        
        recommendations.push({
            type: 'warning',
            icon: '⚠️',
            text: `QR code at size ${currentSize} may be hard to scan${reasonText}. `,
            actionText: `Increase to ${optimalSize}`,
            action: () => {
                sizeRange.value = optimalSize;
                sizeValue.textContent = optimalSize;
                saveCurrentState(`Optimized size to ${optimalSize}`);
                generateQRCode();
                
                if (typeof gtag !== 'undefined') {
                    gtag('event', 'size_optimized', {
                        'from': currentSize,
                        'to': optimalSize,
                        'source': 'quality_score_recommendation',
                        'severity': 'warning'
                    });
                }
            }
        });
    }
    
    // 5. Style Choice (10 points)
    if (currentQRStyle === 'squares') {
        score += 10;
    } else if (currentQRStyle === 'rounded') {
        score += 8;
    } else {
        score += 6;
        if (logoSize > 30) {
            recommendations.push({
                type: 'info',
                icon: 'ℹ️',
                text: 'Dots style with large logo may affect scanning. ',
                actionText: 'Switch to squares',
                action: () => {
                    document.querySelector('.style-btn[data-style="squares"]').click();
                    generateQRCode();
                }
            });
        }
    }
    
    // 6. Error Correction Level (check if appropriate for design)
    const errorCorrectionLevels = { 'L': 1, 'M': 2, 'Q': 3, 'H': 4 };
    const currentECLevel = errorCorrectionLevels[currentErrorCorrectionLevel] || 4;
    
    // Check if higher error correction is needed
    if ((selectedLogo || isArtisticMode) && currentECLevel < 4) {
        // Logo or artistic mode active but not using High error correction
        const recommendedLevel = (logoSize > 25 || isArtisticMode) ? 'H' : 'Q';
        const recommendedName = recommendedLevel === 'H' ? 'High (30%)' : 'Quality (25%)';
        
        recommendations.push({
            type: 'warning',
            icon: '🛡️',
            text: `Error correction is ${currentErrorCorrectionLevel}. With ${selectedLogo ? 'logo' : 'artistic background'}, `,
            actionText: `upgrade to ${recommendedName}`,
            action: () => {
                errorCorrectionLevel.value = recommendedLevel;
                currentErrorCorrectionLevel = recommendedLevel;
                generateQRCode();
                
                // Track in analytics
                if (typeof gtag !== 'undefined') {
                    gtag('event', 'error_correction_changed', {
                        'from': currentErrorCorrectionLevel,
                        'to': recommendedLevel,
                        'source': 'quality_score_recommendation'
                    });
                }
            }
        });
        
        // Deduct points based on gap
        if (currentECLevel === 1) { // L
            score -= 10; // Significant risk with logo/artistic mode
        } else if (currentECLevel === 2) { // M
            score -= 5;
        } else if (currentECLevel === 3) { // Q
            score -= 2;
        }
    } else if (currentECLevel < 3 && dataUsage > 80) {
        // High data usage with low error correction
        recommendations.push({
            type: 'info',
            icon: 'ℹ️',
            text: 'QR code is full. ',
            actionText: 'Increase error correction to Q or H',
            action: () => {
                errorCorrectionLevel.value = 'Q';
                currentErrorCorrectionLevel = 'Q';
                generateQRCode();
            }
        });
    }
    
    // 7. Artistic QR Mode (affects score if active)
    if (isArtisticMode) {
        // Deduct points based on background settings that may affect scannability
        let artisticPenalty = 0;
        
        // Background opacity penalty
        if (currentBgOpacity > 70) {
            artisticPenalty += 15;
            recommendations.push({
                type: 'warning',
                icon: '🎨',
                text: `Background opacity at ${currentBgOpacity}%. `,
                actionText: 'Reduce to 40-50% for better scanning',
                action: () => {
                    bgOpacityRange.value = 45;
                    bgOpacityValue.textContent = '45';
                    currentBgOpacity = 45;
                    generateQRCode();
                }
            });
        } else if (currentBgOpacity > 50) {
            artisticPenalty += 8;
        }
        
        // QR strength bonus/penalty
        if (currentQrStrength >= 85) {
            // Good QR strength, minimal penalty
            artisticPenalty -= 5; // Actually reduce the penalty
        } else if (currentQrStrength < 70) {
            artisticPenalty += 12;
            recommendations.push({
                type: 'warning',
                icon: '🎨',
                text: `QR strength at ${currentQrStrength}%. `,
                actionText: 'Increase to 85% for reliability',
                action: () => {
                    qrStrengthRange.value = 85;
                    qrStrengthValue.textContent = '85';
                    currentQrStrength = 85;
                    generateQRCode();
                }
            });
        }
        
        // Blend mode considerations
        if (currentBlendMode === 'overlay') {
            // Best blend mode, no penalty
        } else if (currentBlendMode === 'normal') {
            artisticPenalty += 3;
        } else {
            artisticPenalty += 5;
            recommendations.push({
                type: 'info',
                icon: '🎨',
                text: `Blend mode: ${currentBlendMode}. `,
                actionText: 'Try "Overlay" for better results',
                action: () => {
                    blendModeSelect.value = 'overlay';
                    currentBlendMode = 'overlay';
                    generateQRCode();
                }
            });
        }
        
        // Apply penalty (max 25 points)
        score -= Math.min(artisticPenalty, 25);
        
        // Add general artistic mode note
        if (artisticPenalty < 10) {
            recommendations.push({
                type: 'success',
                icon: '🎨',
                text: 'Artistic mode active with good settings! Always test with a real phone camera.',
                action: null
            });
        }
    }
    
    // Add success message if score is high
    if (score >= 95) {
        recommendations.unshift({
            type: 'success',
            icon: '🎉',
            text: 'Perfect! This QR code will scan reliably in any conditions.',
            action: null
        });
    } else if (score >= 85) {
        recommendations.unshift({
            type: 'success',
            icon: '✅',
            text: 'Excellent QR code! Very reliable scanning expected.',
            action: null
        });
    }
    
    // Display score
    displayQualityScore(score, recommendations);
}

// Display Quality Score UI
function displayQualityScore(score, recommendations) {
    const scoreSection = document.getElementById('qualityScore');
    const scoreBar = document.getElementById('scoreBar');
    const scoreValue = document.getElementById('scoreValue');
    const scoreRating = document.getElementById('scoreRating');
    const recommendationsDiv = document.getElementById('recommendations');
    
    // Show section
    scoreSection.style.display = 'block';
    
    // Update score bar
    scoreBar.style.width = score + '%';
    scoreValue.textContent = score;
    
    // Determine rating class and text
    let ratingClass = '';
    let ratingText = '';
    if (score >= 95) {
        ratingClass = 'perfect';
        ratingText = '⭐⭐⭐⭐⭐ Perfect';
    } else if (score >= 85) {
        ratingClass = 'excellent';
        ratingText = '⭐⭐⭐⭐☆ Excellent';
    } else if (score >= 70) {
        ratingClass = 'good';
        ratingText = '⭐⭐⭐☆☆ Good';
    } else if (score >= 50) {
        ratingClass = 'fair';
        ratingText = '⭐⭐☆☆☆ Fair';
    } else {
        ratingClass = 'poor';
        ratingText = '⭐☆☆☆☆ Poor';
    }
    
    scoreBar.className = 'score-bar ' + ratingClass;
    scoreRating.textContent = ratingText;
    
    // Build recommendations HTML
    if (recommendations.length === 0) {
        recommendationsDiv.innerHTML = '<div class="recommendation-item success"><span class="recommendation-icon">✅</span><span class="recommendation-text">No issues found!</span></div>';
    } else {
        recommendationsDiv.innerHTML = recommendations.map(rec => {
            const actionHTML = rec.action 
                ? `<span class="recommendation-action">${rec.actionText}</span>`
                : '';
            
            return `
                <div class="recommendation-item ${rec.type}">
                    <span class="recommendation-icon">${rec.icon}</span>
                    <span class="recommendation-text">
                        ${rec.text}${actionHTML}
                    </span>
                </div>
            `;
        }).join('');
        
        // Attach click handlers to actions
        recommendationsDiv.querySelectorAll('.recommendation-action').forEach((el, index) => {
            const rec = recommendations.filter(r => r.action)[index];
            if (rec && rec.action) {
                el.addEventListener('click', rec.action);
            }
        });
    }
}

// Helper function to apply color preset
function applyColorPreset(dark, light) {
    darkColorPicker.value = dark;
    lightColorPicker.value = light;
    darkColorText.value = dark;
    lightColorText.value = light;
    currentDarkColor = dark;
    currentLightColor = light;
    
    // Update preset button states
    colorPresets.forEach(btn => {
        if (btn.dataset.dark === dark && btn.dataset.light === light) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    // Regenerate QR code
    generateQRCode();
}

// Apply QR code style (dots or rounded)
function applyQRStyle(ctx, qrSize, offsetX = 0, offsetY = 0) {
    // Get the QR code area
    const imageData = ctx.getImageData(offsetX, offsetY, qrSize, qrSize);
    const data = imageData.data;
    
    // Detect module size more accurately
    // QR codes are always odd-sized (21, 25, 29, 33, etc.)
    let moduleSize = Math.round(qrSize / 33); // Default estimate
    
    // Better detection: scan for transitions from light to dark
    let transitionCount = 0;
    for (let x = 0; x < qrSize - 1; x++) {
        const i1 = (0 * qrSize + x) * 4;
        const i2 = (0 * qrSize + x + 1) * 4;
        const bright1 = (data[i1] + data[i1 + 1] + data[i1 + 2]) / 3;
        const bright2 = (data[i2] + data[i2 + 1] + data[i2 + 2]) / 3;
        if (Math.abs(bright1 - bright2) > 100) {
            transitionCount++;
        }
    }
    
    // Estimate module size from transitions (QR codes typically have 21-177 modules)
    if (transitionCount > 0) {
        const estimatedModules = transitionCount * 2; // Approximate
        if (estimatedModules >= 21 && estimatedModules <= 177) {
            moduleSize = Math.round(qrSize / estimatedModules);
        }
    }
    
    // Ensure module size is at least 1 and makes sense
    moduleSize = Math.max(1, Math.min(moduleSize, Math.floor(qrSize / 21)));
    
    // Calculate number of modules to ensure we cover the entire QR code
    const moduleCount = Math.ceil(qrSize / moduleSize);
    
    // Clear the QR area and fill with background
    ctx.fillStyle = currentLightColor;
    ctx.fillRect(offsetX, offsetY, qrSize, qrSize);
    
    // Enable anti-aliasing for smooth shapes
    ctx.imageSmoothingEnabled = true;
    
    ctx.fillStyle = currentDarkColor;
    
    // Draw styled modules - iterate through all module positions
    for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
            const y = row * moduleSize;
            const x = col * moduleSize;
            
            // Make sure we don't go out of bounds
            if (y >= qrSize || x >= qrSize) continue;
            
            // Check multiple pixels in this module to determine if it's dark
            let darkPixels = 0;
            let totalPixels = 0;
            const sampleSize = Math.min(moduleSize, 3); // Sample up to 3x3 pixels per module
            for (let dy = 0; dy < sampleSize && (y + dy) < qrSize; dy++) {
                for (let dx = 0; dx < sampleSize && (x + dx) < qrSize; dx++) {
                    const i = ((y + dy) * qrSize + (x + dx)) * 4;
                    const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
                    if (brightness < 128) darkPixels++;
                    totalPixels++;
                }
            }
            
            // Consider module dark if majority of sampled pixels are dark
            const isDark = darkPixels > totalPixels / 2;
            
            if (isDark) {
                if (currentQRStyle === 'dots') {
                    // Draw circle
                    ctx.beginPath();
                    ctx.arc(
                        offsetX + x + moduleSize / 2,
                        offsetY + y + moduleSize / 2,
                        moduleSize / 2.0,
                        0,
                        Math.PI * 2
                    );
                    ctx.fill();
                } else if (currentQRStyle === 'rounded') {
                    // Draw rounded rectangle (with fallback for older browsers)
                    const radius = moduleSize / 4;
                    if (typeof ctx.roundRect === 'function') {
                        ctx.beginPath();
                        ctx.roundRect(offsetX + x, offsetY + y, moduleSize, moduleSize, radius);
                        ctx.fill();
                    } else {
                        // Fallback: draw regular rectangle
                        ctx.fillRect(offsetX + x, offsetY + y, moduleSize, moduleSize);
                    }
                }
            }
        }
    }
    
    // Restore image smoothing setting
    ctx.imageSmoothingEnabled = false;
}

// Download QR Code as PNG
downloadPngBtn.addEventListener('click', async () => {
    // Check if there are selected bucket items
    const selectedQRs = qrBucket.filter(qr => qr.selected);
    
    if (selectedQRs.length > 0) {
        // Download selected bucket items with metadata
        if (selectedQRs.length === 1) {
            // Single item: download directly
            const qr = selectedQRs[0];
            const blob = (function() {
                const b64 = qr.dataURL.split(',')[1];
                const bin = atob(b64);
                const arr = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                return new Blob([arr], { type: 'image/png' });
            })();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const fileName = qr.metadata.label || 'qr-code';
            link.download = `${getTimestampPrefix()}_${fileName.replace(/[^a-z0-9]/gi, '_')}.png`;
            link.href = url;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 30000);
            showNotification('Selected QR Code downloaded as PNG with metadata!');
        } else {
            // Multiple items: create ZIP
            const JSZip = window.JSZip ? window.JSZip : null;
            if (!JSZip) {
                alert('JSZip library not loaded. Cannot create ZIP file.');
                return;
            }
            const zip = new JSZip();
            selectedQRs.forEach((qr, index) => {
                const qrNum = index + 1;
                const fileName = qr.metadata.label ? `${qr.metadata.label.replace(/[^a-z0-9]/gi, '_')}.png` : `qr-${qrNum}.png`;
                const qrBase64 = qr.dataURL.split(',')[1];
                if (qrBase64) {
                    zip.file(fileName, qrBase64, {base64: true});
                }
            });
            const blob = await zip.generateAsync({type: 'blob'});
            const link = document.createElement('a');
            link.download = `${getTimestampPrefix()}_qr-codes-with-metadata.zip`;
            link.href = URL.createObjectURL(blob);
            link.click();
            URL.revokeObjectURL(link.href);
            showNotification(`${selectedQRs.length} QR Codes downloaded as PNG with metadata!`);
        }
        
        if (typeof gtag !== 'undefined') {
            gtag('event', 'download_batch_png', {
                'format': 'PNG',
                'count': selectedQRs.length,
                'from_bucket': 'yes'
            });
        }
        return;
    }
    
    // Fallback: download current QR code
    if (!currentQRDataURL) {
        alert('Please generate a QR code first or select items from the bucket!');
        return;
    }
    
    const label = labelInput.value.trim();
    
    // Embed metadata into PNG so re-uploads can restore state
    const meta = {
        text: textInput.value.trim(),
        label: labelInput.value.trim(),
        blendMode: currentBlendMode,
        bgOpacity: currentBgOpacity,
        qrStrength: currentQrStrength,
        timestamp: Date.now(),
        aiBackground: lastAiBackgroundMeta || null
    };

    let dataWithMeta = currentQRDataURL;
    try {
        // First embed QR_META
        dataWithMeta = insertTextChunkToPNG(dataWithMeta, 'QR_META', JSON.stringify(meta));

        // Also compute analytics and embed as separate chunk QR_ANALYTICS
        const analytics = computeAnalytics(parseInt(sizeRange.value || 1024));
        try {
            dataWithMeta = insertTextChunkToPNG(dataWithMeta, 'QR_ANALYTICS', JSON.stringify(analytics));
        } catch (ae) {
            console.warn('Failed to embed analytics chunk', ae);
        }
    } catch (e) {
        console.warn('Failed to embed metadata into PNG, falling back to plain PNG', e);
        dataWithMeta = currentQRDataURL;
    }

    // Download the preview canvas (which already includes label if present)
    const blob = (function() {
        const b64 = dataWithMeta.split(',')[1];
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new Blob([arr], { type: 'image/png' });
    })();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `${getTimestampPrefix()}_qr-code.png`;
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    
    // Track download
    if (typeof gtag !== 'undefined') {
        gtag('event', 'download_single_png', {
            'format': 'PNG',
            'has_label': label ? 'yes' : 'no'
        });
    }
    
    showNotification('QR Code downloaded as PNG!');
});

// Download QR Code as SVG
downloadSvgBtn.addEventListener('click', async () => {
    // Check if there are selected bucket items
    const selectedQRs = qrBucket.filter(qr => qr.selected);
    
    if (selectedQRs.length > 0) {
        // Download selected bucket items as SVG
        if (selectedQRs.length === 1) {
            // Single item: convert canvas to SVG
            const qr = selectedQRs[0];
            const svg = canvasToSVGFromCanvas(qr.canvas);
            const blob = new Blob([svg], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const fileName = qr.metadata.label || 'qr-code';
            link.download = `${getTimestampPrefix()}_${fileName.replace(/[^a-z0-9]/gi, '_')}.svg`;
            link.href = url;
            link.click();
            URL.revokeObjectURL(url);
            showNotification('Selected QR Code downloaded as SVG!');
        } else {
            // Multiple items: create ZIP of SVGs
            const JSZip = window.JSZip ? window.JSZip : null;
            if (!JSZip) {
                alert('JSZip library not loaded. Cannot create ZIP file.');
                return;
            }
            const zip = new JSZip();
            selectedQRs.forEach((qr, index) => {
                const qrNum = index + 1;
                const fileName = qr.metadata.label ? `${qr.metadata.label.replace(/[^a-z0-9]/gi, '_')}.svg` : `qr-${qrNum}.svg`;
                const svg = canvasToSVGFromCanvas(qr.canvas);
                zip.file(fileName, svg);
            });
            const blob = await zip.generateAsync({type: 'blob'});
            const link = document.createElement('a');
            link.download = `${getTimestampPrefix()}_qr-codes.zip`;
            link.href = URL.createObjectURL(blob);
            link.click();
            URL.revokeObjectURL(link.href);
            showNotification(`${selectedQRs.length} QR Codes downloaded as SVG!`);
        }
        
        if (typeof gtag !== 'undefined') {
            gtag('event', 'download_batch_svg', {
                'format': 'SVG',
                'count': selectedQRs.length,
                'from_bucket': 'yes'
            });
        }
        return;
    }
    
    // Fallback: download current QR code
    if (!currentQRDataURL) {
        alert('Please generate a QR code first or select items from the bucket!');
        return;
    }
    
    // Convert canvas to SVG
    const svg = canvasToSVG();
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.download = `${getTimestampPrefix()}_qr-code.svg`;
    link.href = url;
    link.click();
    
    URL.revokeObjectURL(url);
    
    // Track download
    if (typeof gtag !== 'undefined') {
        gtag('event', 'download_single_svg', {
            'format': 'SVG'
        });
    }
    
    showNotification('QR Code downloaded as SVG!');
});

// Download QR Code as JPG
downloadJpgBtn.addEventListener('click', async () => {
    // Check if there are selected bucket items
    const selectedQRs = qrBucket.filter(qr => qr.selected);
    
    if (selectedQRs.length > 0) {
        // Download selected bucket items as JPG
        if (selectedQRs.length === 1) {
            // Single item: convert to JPG
            const qr = selectedQRs[0];
            const canvas = document.createElement('canvas');
            canvas.width = qr.canvas.width;
            canvas.height = qr.canvas.height;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(qr.canvas, 0, 0);
            
            const link = document.createElement('a');
            const fileName = qr.metadata.label || 'qr-code';
            link.download = `${getTimestampPrefix()}_${fileName.replace(/[^a-z0-9]/gi, '_')}.jpg`;
            link.href = canvas.toDataURL('image/jpeg', 0.95);
            link.click();
            showNotification('Selected QR Code downloaded as JPG!');
        } else {
            // Multiple items: create ZIP of JPGs
            const JSZip = window.JSZip ? window.JSZip : null;
            if (!JSZip) {
                alert('JSZip library not loaded. Cannot create ZIP file.');
                return;
            }
            const zip = new JSZip();
            selectedQRs.forEach((qr, index) => {
                const qrNum = index + 1;
                const canvas = document.createElement('canvas');
                canvas.width = qr.canvas.width;
                canvas.height = qr.canvas.height;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(qr.canvas, 0, 0);
                
                const fileName = qr.metadata.label ? `${qr.metadata.label.replace(/[^a-z0-9]/gi, '_')}.jpg` : `qr-${qrNum}.jpg`;
                const jpgBase64 = canvas.toDataURL('image/jpeg', 0.95).split(',')[1];
                if (jpgBase64) {
                    zip.file(fileName, jpgBase64, {base64: true});
                }
            });
            const blob = await zip.generateAsync({type: 'blob'});
            const link = document.createElement('a');
            link.download = `${getTimestampPrefix()}_qr-codes.zip`;
            link.href = URL.createObjectURL(blob);
            link.click();
            URL.revokeObjectURL(link.href);
            showNotification(`${selectedQRs.length} QR Codes downloaded as JPG!`);
        }
        
        if (typeof gtag !== 'undefined') {
            gtag('event', 'download', {
                'format': 'JPG',
                'count': selectedQRs.length,
                'from_bucket': 'yes'
            });
        }
        return;
    }
    
    // Fallback: download current QR code
    if (!currentQRDataURL) {
        alert('Please generate a QR code first or select items from the bucket!');
        return;
    }
    
    const label = labelInput.value.trim();
    
    // Convert PNG to JPG (with white background)
    const canvas = document.createElement('canvas');
    canvas.width = qrCanvas.width;
    canvas.height = qrCanvas.height;
    const ctx = canvas.getContext('2d');
    
    // Fill white background (JPG doesn't support transparency)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(qrCanvas, 0, 0);
    
    const link = document.createElement('a');
    link.download = `${getTimestampPrefix()}_qr-code.jpg`;
    link.href = canvas.toDataURL('image/jpeg', 0.95);
    link.click();
    
    // Track download
    if (typeof gtag !== 'undefined') {
        gtag('event', 'download_single_jpg', {
            'format': 'JPG',
            'has_label': label ? 'yes' : 'no'
        });
    }
    
    showNotification('QR Code downloaded as JPG!');
});

// Download QR Code as PDF
downloadPdfBtn.addEventListener('click', () => {
    // Check if there are selected bucket items
    const selectedQRs = qrBucket.filter(qr => qr.selected);
    
    if (selectedQRs.length > 0) {
        // Download selected bucket items as PDF
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });
        
        const pdfWidth = 210;
        const pdfHeight = 297;
        const margin = 10;
        const cols = 2;
        const rows = 4;
        const perPage = cols * rows;
        
        const cellWidth = (pdfWidth - margin * (cols + 1)) / cols;
        const cellHeight = (pdfHeight - margin * (rows + 1)) / rows;
        const qrSize = Math.min(cellWidth, cellHeight);
        
        selectedQRs.forEach((qr, index) => {
            const pageIndex = Math.floor(index / perPage);
            const indexOnPage = index % perPage;
            const col = indexOnPage % cols;
            const row = Math.floor(indexOnPage / cols);
            const x = margin + col * (qrSize + margin);
            const y = margin + row * (cellHeight + margin);
            
            // Calculate dimensions maintaining aspect ratio and fitting within cell
            const imgAspect = qr.canvas.height / qr.canvas.width;
            let imgWidth = qrSize;
            let imgHeight = qrSize * imgAspect;
            
            // If height exceeds cell, scale down to fit
            if (imgHeight > cellHeight) {
                imgHeight = cellHeight;
                imgWidth = cellHeight / imgAspect;
            }
            
            const xOffset = (qrSize - imgWidth) / 2;
            const yOffset = (cellHeight - imgHeight) / 2;
            
            if (index > 0 && indexOnPage === 0) {
                pdf.addPage();
            }
            pdf.addImage(qr.dataURL, 'PNG', x + xOffset, y + yOffset, imgWidth, imgHeight);
        });
        
        pdf.save(`${getTimestampPrefix()}_qr-codes.pdf`);
        showNotification(`${selectedQRs.length} QR Codes downloaded as PDF!`);
        
        if (typeof gtag !== 'undefined') {
            gtag('event', 'download_batch_pdf', {
                'format': 'PDF',
                'count': selectedQRs.length,
                'from_bucket': 'yes'
            });
        }
        return;
    }
    
    // Fallback: download current QR code or multi-QR pairs
    if (!currentQRDataURL) {
        // Try to find multi-QR pairs from the UI (if present)
        let pairs = window.multiQRPairs || [];
        // Fallback: try to find from a global or DOM if available
        if (!pairs.length && typeof getMultiQRPairs === 'function') {
            pairs = getMultiQRPairs();
        }
        // Or try to find from a known variable
        if (!pairs.length && window.lastMultiQRPairs) {
            pairs = window.lastMultiQRPairs;
        }
        if (pairs && pairs.length > 0) {
            downloadMultiQRAsPDF(pairs);
            return;
        } else {
            alert('Please generate a QR code first or select items from the bucket!');
            return;
        }
    }

    const label = labelInput.value.trim();

    // Use the preview canvas which already includes label
    const imgData = qrCanvas.toDataURL('image/png');

    // Calculate PDF dimensions (A4 size in mm, portrait)
    const pdfWidth = 210; // A4 width in mm
    const pdfHeight = 297; // A4 height in mm

    // Calculate image dimensions to fit on page
    const imgWidth = 150; // QR code width in mm on PDF
    const imgHeight = (qrCanvas.height / qrCanvas.width) * imgWidth;
    
    // Center the image on the page
    const x = (pdfWidth - imgWidth) / 2;
    const y = (pdfHeight - imgHeight) / 3;
    
    // Create PDF using jsPDF
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
    });
    
    pdf.addImage(imgData, 'PNG', x, y, imgWidth, imgHeight);
    pdf.save(`${getTimestampPrefix()}_qr-code.pdf`);
    
    // Track download
    if (typeof gtag !== 'undefined') {
        gtag('event', 'download_single_pdf', {
            'format': 'PDF',
            'has_label': label ? 'yes' : 'no'
        });
    }
    
    showNotification('QR Code downloaded as PDF!');
});

// Bucket download functions
downloadBucketPdfBtn.addEventListener('click', () => {
    if (qrBucket.length === 0) {
        alert('Please add QR codes to the bucket first!');
        return;
    }

    // Filter to only selected QR codes
    const selectedQRs = qrBucket.filter(qr => qr.selected);
    if (selectedQRs.length === 0) {
        alert('Please select at least one QR code from the bucket!');
        return;
    }

    // Create PDF with 2 columns × 4 rows grid, paginating as needed
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
    });

    const pageWidth = 210;  // A4 width in mm
    const pageHeight = 297; // A4 height in mm
    const margin = 10;
    const cols = 2;
    const rows = 4;
    const perPage = cols * rows;

    const cellWidth = (pageWidth - margin * (cols + 1)) / cols;
    const cellHeight = (pageHeight - margin * (rows + 1)) / rows;
    const qrSize = Math.min(cellWidth, cellHeight);

    selectedQRs.forEach((qr, index) => {
        const pageIndex = Math.floor(index / perPage);
        const indexOnPage = index % perPage;
        const col = indexOnPage % cols;
        const row = Math.floor(indexOnPage / cols);
        const x = margin + col * (qrSize + margin);
        const y = margin + row * (cellHeight + margin);

        // Calculate dimensions maintaining aspect ratio and fitting within cell
        const imgAspect = qr.canvas.height / qr.canvas.width;
        let imgWidth = qrSize;
        let imgHeight = qrSize * imgAspect;
        
        // If height exceeds cell, scale down to fit
        if (imgHeight > cellHeight) {
            imgHeight = cellHeight;
            imgWidth = cellHeight / imgAspect;
        }
        
        const xOffset = (qrSize - imgWidth) / 2;
        const yOffset = (cellHeight - imgHeight) / 2;

        if (index > 0 && indexOnPage === 0) {
            pdf.addPage();
        }
        pdf.addImage(qr.dataURL, 'PNG', x + xOffset, y + yOffset, imgWidth, imgHeight);
    });

    pdf.save(`${getTimestampPrefix()}_qr-codes-batch.pdf`);
    showNotification(`${selectedQRs.length} QR codes downloaded as PDF grid!`);

    if (typeof gtag !== 'undefined') {
        gtag('event', 'download_batch_pdf', {
            'format': 'PDF',
            'count': selectedQRs.length
        });
    }
});

downloadBucketPngBtn.addEventListener('click', async () => {
    if (qrBucket.length === 0) {
        alert('Please add QR codes to the bucket first!');
        return;
    }
    
    // Filter to only selected QR codes
    const selectedQRs = qrBucket.filter(qr => qr.selected);
    if (selectedQRs.length === 0) {
        alert('Please select at least one QR code from the bucket!');
        return;
    }
    
    // Create a zip file with all PNG images
    const JSZip = window.JSZip ? window.JSZip : null;
    if (!JSZip) {
        // Fallback: download individually
        selectedQRs.forEach((qr, index) => {
            const link = document.createElement('a');
            const fileName = qr.label ? `${qr.label.replace(/[^a-z0-9]/gi, '_')}.png` : `qr-code-${index + 1}.png`;
            link.download = fileName;
            link.href = qr.dataURL;
            link.click();
        });
        showNotification(`${selectedQRs.length} PNG files downloaded!`);
        return;
    }
    
    const zip = new JSZip();
    selectedQRs.forEach((qr, index) => {
        const qrNum = index + 1;
        
        // Add QR code with numbered filename
        const qrFileName = `qr-${qrNum}.png`;
        const qrBase64 = qr.dataURL.split(',')[1];
        if (!qrBase64) {
            console.warn(`Skipping QR ${qrNum} - invalid dataURL`);
            return;
        }
        zip.file(qrFileName, qrBase64, {base64: true});
        
        // Add background image if it exists with matching number
        if (qr.metadata.artistic && qr.metadata.artistic.backgroundDataURL) {
            const bgFileName = `background-${qrNum}.png`;
            const bgBase64 = qr.metadata.artistic.backgroundDataURL.split(',')[1];
            if (bgBase64) {
                zip.file(bgFileName, bgBase64, {base64: true});
            }
        }
    });
    
    const blob = await zip.generateAsync({type: 'blob'});
    const link = document.createElement('a');
    link.download = `${getTimestampPrefix()}_qr-codes.zip`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
    
    showNotification(`${selectedQRs.length} PNG files downloaded as ZIP!`);
    
    if (typeof gtag !== 'undefined') {
        gtag('event', 'download_batch_png', {
            'format': 'PNG_ZIP',
            'count': selectedQRs.length
        });
    }
});

downloadBucketJpgBtn.addEventListener('click', async () => {
    if (qrBucket.length === 0) {
        alert('Please add QR codes to the bucket first!');
        return;
    }
    
    // Filter to only selected QR codes
    const selectedQRs = qrBucket.filter(qr => qr.selected);
    if (selectedQRs.length === 0) {
        alert('Please select at least one QR code from the bucket!');
        return;
    }
    
    // Convert all to JPG and create zip
    const JSZip = window.JSZip ? window.JSZip : null;
    if (!JSZip) {
        // Fallback: download individually
        selectedQRs.forEach((qr, index) => {
            const canvas = document.createElement('canvas');
            canvas.width = qr.canvas.width;
            canvas.height = qr.canvas.height;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(qr.canvas, 0, 0);
            
            const link = document.createElement('a');
            const fileName = qr.label ? `${qr.label.replace(/[^a-z0-9]/gi, '_')}.jpg` : `qr-code-${index + 1}.jpg`;
            link.download = fileName;
            link.href = canvas.toDataURL('image/jpeg', 0.95);
            link.click();
        });
        showNotification(`${selectedQRs.length} JPG files downloaded!`);
        return;
    }
    
    const zip = new JSZip();
    selectedQRs.forEach((qr, index) => {
        const qrNum = index + 1;
        
        // Convert QR code to JPG
        const canvas = document.createElement('canvas');
        canvas.width = qr.canvas.width;
        canvas.height = qr.canvas.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(qr.canvas, 0, 0);
        
        const qrFileName = `qr-${qrNum}.jpg`;
        const qrBase64 = canvas.toDataURL('image/jpeg', 0.95).split(',')[1];
        if (qrBase64) {
            zip.file(qrFileName, qrBase64, {base64: true});
        }
        
        // Add background image if it exists (convert to JPG too) with matching number
        if (qr.metadata.artistic && qr.metadata.artistic.backgroundDataURL) {
            const bgCanvas = document.createElement('canvas');
            const bgImg = new Image();
            bgImg.src = qr.metadata.artistic.backgroundDataURL;
            bgCanvas.width = bgImg.width || 1024;
            bgCanvas.height = bgImg.height || 1024;
            const bgCtx = bgCanvas.getContext('2d');
            bgCtx.fillStyle = '#ffffff';
            bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
            bgCtx.drawImage(bgImg, 0, 0);
            
            const bgFileName = `background-${qrNum}.jpg`;
            const bgBase64 = bgCanvas.toDataURL('image/jpeg', 0.95).split(',')[1];
            if (bgBase64) {
                zip.file(bgFileName, bgBase64, {base64: true});
            }
        }
    });
    
    const blob = await zip.generateAsync({type: 'blob'});
    const link = document.createElement('a');
    link.download = `${getTimestampPrefix()}_qr-codes.zip`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
    
    showNotification(`${selectedQRs.length} JPG files downloaded as ZIP!`);
    
    if (typeof gtag !== 'undefined') {
        gtag('event', 'download_batch_jpg', {
            'format': 'JPG_ZIP',
            'count': selectedQRs.length
        });
    }
});

// Download Metadata PDF - Complete documentation with all settings
if (downloadMetadataPdfBtn) {
    downloadMetadataPdfBtn.addEventListener('click', () => {
        if (qrBucket.length === 0) {
            alert('Please add QR codes to the bucket first!');
            return;
        }
        
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });
        
        const pageWidth = 210;
        const pageHeight = 297;
        const margin = 15;
        const contentWidth = pageWidth - (margin * 2);
        
        let yPos = margin;
        
        // Title page
        pdf.setFontSize(24);
        pdf.setFont(undefined, 'bold');
        pdf.text('QR Code Metadata Documentation', margin, yPos);
        
        yPos += 10;
        pdf.setFontSize(12);
        pdf.setFont(undefined, 'normal');
        pdf.text(`Generated: ${new Date().toLocaleString()}`, margin, yPos);
        pdf.text(`Total QR Codes: ${qrBucket.length}`, margin, yPos + 6);
        
        yPos += 20;
        
        // Add each QR code with metadata
        qrBucket.forEach((qr, index) => {
            const meta = qr.metadata;
            
            // Check if we need a new page
            if (yPos > pageHeight - 100) {
                pdf.addPage();
                yPos = margin;
            }
            
            // Section header
            pdf.setFontSize(16);
            pdf.setFont(undefined, 'bold');
            pdf.text(`QR Code #${index + 1}`, margin, yPos);
            yPos += 8;
            
            // Add QR code image
            const qrSize = 50;
            pdf.addImage(qr.dataURL, 'PNG', margin, yPos, qrSize, qrSize);
            
            // Add metadata next to image
            let metaX = margin + qrSize + 10;
            let metaY = yPos;
            
            pdf.setFontSize(10);
            pdf.setFont(undefined, 'bold');
            pdf.text('Label:', metaX, metaY);
            pdf.setFont(undefined, 'normal');
            const labelText = meta.label || '(none)';
            pdf.text(labelText.substring(0, 40), metaX + 15, metaY);
            metaY += 5;
            
            pdf.setFont(undefined, 'bold');
            pdf.text('Notes:', metaX, metaY);
            pdf.setFont(undefined, 'normal');
            const notesText = meta.notes || '(none)';
            const notesLines = pdf.splitTextToSize(notesText, contentWidth - qrSize - 25);
            pdf.text(notesLines, metaX + 15, metaY);
            metaY += (notesLines.length * 5);
            
            metaY += 3;
            pdf.setFont(undefined, 'bold');
            pdf.text('Created:', metaX, metaY);
            pdf.setFont(undefined, 'normal');
            pdf.text(new Date(meta.timestamp).toLocaleString(), metaX + 20, metaY);
            
            yPos += qrSize + 5;
            
            // Content/Text data
            pdf.setFontSize(9);
            pdf.setFont(undefined, 'bold');
            pdf.text('Content:', margin, yPos);
            pdf.setFont(undefined, 'normal');
            const contentLines = pdf.splitTextToSize(meta.text, contentWidth - 20);
            pdf.text(contentLines.slice(0, 3), margin + 20, yPos);
            yPos += Math.min(contentLines.length, 3) * 4;
            
            yPos += 5;
            
            // Settings in two columns
            pdf.setFont(undefined, 'bold');
            pdf.text('Settings:', margin, yPos);
            yPos += 5;
            
            pdf.setFontSize(8);
            pdf.setFont(undefined, 'normal');
            
            const col1X = margin + 5;
            const col2X = margin + contentWidth / 2;
            let settingsY = yPos;
            
            // Column 1 - Basic Settings
            pdf.text(`Size: ${meta.settings.size}`, col1X, settingsY);
            settingsY += 4;
            pdf.text(`Border: ${meta.settings.border}`, col1X, settingsY);
            settingsY += 4;
            pdf.text(`Logo Size: ${meta.settings.logoSize}%`, col1X, settingsY);
            settingsY += 4;
            pdf.text(`Label Size: ${meta.settings.labelSize}%`, col1X, settingsY);
            settingsY += 4;
            pdf.text(`Style: ${meta.style}`, col1X, settingsY);
            
            // Column 2 - Colors
            settingsY = yPos;
            pdf.text(`Dark Color: ${meta.colors.dark}`, col2X, settingsY);
            settingsY += 4;
            pdf.text(`Light Color: ${meta.colors.light}`, col2X, settingsY);
            settingsY += 4;
            pdf.text(`Label Color: ${meta.colors.label}`, col2X, settingsY);
            settingsY += 4;
            pdf.text(`Has Logo: ${meta.logo.hasLogo ? 'Yes' : 'No'}`, col2X, settingsY);
            
            yPos += 20;
            
            // Artistic settings if applicable
            if (meta.artistic.hasBackground) {
                pdf.setFontSize(9);
                pdf.setFont(undefined, 'bold');
                pdf.text('Artistic QR Settings:', margin, yPos);
                yPos += 5;
                
                pdf.setFontSize(8);
                pdf.setFont(undefined, 'normal');
                pdf.text(`Blend Mode: ${meta.artistic.blendMode}`, col1X, yPos);
                pdf.text(`BG Opacity: ${meta.artistic.bgOpacity}%`, col2X, yPos);
                yPos += 4;
                pdf.text(`QR Strength: ${meta.artistic.qrStrength}%`, col1X, yPos);
                yPos += 5;
                
                // Add AI prompts if available
                if (meta.artistic.context || meta.artistic.imagePrompt) {
                    pdf.setFont(undefined, 'bold');
                    pdf.text('AI Generation Details:', margin, yPos);
                    yPos += 4;
                    
                    pdf.setFont(undefined, 'normal');
                    if (meta.artistic.context) {
                        pdf.setFont(undefined, 'bold');
                        pdf.text('Context (What\'s your QR code for?):', margin + 2, yPos);
                        yPos += 4;
                        pdf.setFont(undefined, 'normal');
                        const contextLines = pdf.splitTextToSize(meta.artistic.context, contentWidth - 5);
                        pdf.text(contextLines, margin + 4, yPos);
                        yPos += (contextLines.length * 4) + 2;
                    }
                    
                    if (meta.artistic.imagePrompt) {
                        pdf.setFont(undefined, 'bold');
                        pdf.text('Image Description Used:', margin + 2, yPos);
                        yPos += 4;
                        pdf.setFont(undefined, 'normal');
                        const promptLines = pdf.splitTextToSize(meta.artistic.imagePrompt, contentWidth - 5);
                        pdf.text(promptLines, margin + 4, yPos);
                        yPos += (promptLines.length * 4) + 2;
                    }
                    
                    // Show other generated suggestions that were not used
                    if (meta.artistic.allGeneratedSuggestions && Array.isArray(meta.artistic.allGeneratedSuggestions)) {
                        const unusedSuggestions = meta.artistic.allGeneratedSuggestions.filter(
                            s => s.prompt !== meta.artistic.imagePrompt
                        );
                        
                        if (unusedSuggestions.length > 0) {
                            pdf.setFont(undefined, 'bold');
                            pdf.text('Image Descriptions Not Used:', margin + 2, yPos);
                            yPos += 4;
                            pdf.setFont(undefined, 'normal');
                            
                            unusedSuggestions.forEach((suggestion, idx) => {
                                const suggestionText = `${idx + 1}. ${suggestion.title}: ${suggestion.prompt}`;
                                const suggestionLines = pdf.splitTextToSize(suggestionText, contentWidth - 5);
                                pdf.text(suggestionLines, margin + 4, yPos);
                                yPos += (suggestionLines.length * 4) + 1;
                            });
                            yPos += 2;
                        }
                    }
                }
                
                // Add background image if available
                if (meta.artistic.backgroundDataURL) {
                    try {
                        const bgSize = 40;
                        pdf.text('Background Image:', margin, yPos);
                        yPos += 5;
                        pdf.addImage(meta.artistic.backgroundDataURL, 'PNG', margin, yPos, bgSize, bgSize);
                        yPos += bgSize;
                    } catch (e) {
                        console.error('Error adding background image:', e);
                    }
                }
                
                yPos += 5;
            }
            
            // Add separator line
            yPos += 5;
            pdf.setDrawColor(200, 200, 200);
            pdf.line(margin, yPos, pageWidth - margin, yPos);
            yPos += 10;
        });
        
        pdf.save(`${getTimestampPrefix()}_qr-codes-metadata.pdf`);
        showNotification(`Metadata PDF with ${qrBucket.length} QR codes downloaded!`);
        
        if (typeof gtag !== 'undefined') {
            gtag('event', 'download_metadata_pdf', {
                'count': qrBucket.length
            });
        }
    });
}

// Download Printable PDF - Clean layout with QR codes on left, notes summary on right
if (downloadPrintablePdfBtn) {
    downloadPrintablePdfBtn.addEventListener('click', () => {
        if (qrBucket.length === 0) {
            alert('Please add QR codes to the bucket first!');
            return;
        }
        
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });
        
        const pageWidth = 210;
        const pageHeight = 297;
        const margin = 15;
        const contentWidth = pageWidth - (margin * 2);
        
        // Layout: Left side for QR codes, Right side for notes summary
        const leftColWidth = contentWidth * 0.45;  // 45% for QR codes
        const rightColWidth = contentWidth * 0.50;  // 50% for notes
        const colGap = contentWidth * 0.05;         // 5% gap
        const rightColX = margin + leftColWidth + colGap;
        
        let leftYPos = margin;
        let rightYPos = margin;
        
        // Title
        pdf.setFontSize(20);
        pdf.setFont(undefined, 'bold');
        pdf.text('QR Codes Reference Sheet', pageWidth / 2, leftYPos, { align: 'center' });
        
        leftYPos += 12;
        rightYPos += 12;
        
        // Column headers
        pdf.setFontSize(12);
        pdf.setFont(undefined, 'bold');
        pdf.text('QR Codes', margin + leftColWidth / 2, leftYPos, { align: 'center' });
        pdf.text('Notes Summary', rightColX + rightColWidth / 2, rightYPos, { align: 'center' });
        
        leftYPos += 8;
        rightYPos += 8;
        
        // Draw vertical separator line
        pdf.setDrawColor(200, 200, 200);
        pdf.setLineWidth(0.5);
        pdf.line(rightColX - 3, margin + 8, rightColX - 3, pageHeight - margin);
        
        // Process each QR code
        qrBucket.forEach((qr, index) => {
            const meta = qr.metadata;
            const refNumber = `#${index + 1}`;
            
            // LEFT COLUMN - QR Code
            // Check if we need a new page for QR code
            const qrSize = Math.min(leftColWidth - 10, 50);
            if (leftYPos > pageHeight - qrSize - 30) {
                pdf.addPage();
                leftYPos = margin;
                rightYPos = margin;
                
                // Redraw separator on new page
                pdf.setDrawColor(200, 200, 200);
                pdf.line(rightColX - 3, margin, rightColX - 3, pageHeight - margin);
            }
            
            // Add reference number above QR code
            pdf.setFontSize(10);
            pdf.setFont(undefined, 'bold');
            pdf.setTextColor(0, 0, 0);
            pdf.text(refNumber, margin + 2, leftYPos);
            leftYPos += 5;
            
            // Draw QR code
            pdf.addImage(qr.dataURL, 'PNG', margin + 5, leftYPos, qrSize, qrSize);
            
            // Add label below QR code if present
            if (meta.label) {
                pdf.setFontSize(8);
                pdf.setFont(undefined, 'normal');
                const labelLines = pdf.splitTextToSize(meta.label, leftColWidth - 10);
                pdf.text(labelLines, margin + 5, leftYPos + qrSize + 4);
                leftYPos += qrSize + 4 + (labelLines.length * 3.5) + 8;
            } else {
                leftYPos += qrSize + 12;
            }
            
            // RIGHT COLUMN - Notes
            // Check if we need a new page for notes
            if (rightYPos > pageHeight - 40) {
                pdf.addPage();
                leftYPos = margin;
                rightYPos = margin;
                
                // Redraw separator on new page
                pdf.setDrawColor(200, 200, 200);
                pdf.line(rightColX - 3, margin, rightColX - 3, pageHeight - margin);
            }
            
            // Notes entry with reference number
            pdf.setFontSize(9);
            pdf.setFont(undefined, 'bold');
            pdf.setTextColor(80, 80, 80);
            
            // Reference number with label if available
            let noteHeader = refNumber;
            if (meta.label) {
                noteHeader += ` - ${meta.label.substring(0, 25)}${meta.label.length > 25 ? '...' : ''}`;
            }
            pdf.text(noteHeader, rightColX, rightYPos);
            rightYPos += 5;
            
            // Notes content
            pdf.setFontSize(8);
            pdf.setFont(undefined, 'normal');
            pdf.setTextColor(0, 0, 0);
            
            if (meta.notes) {
                const notesLines = pdf.splitTextToSize(meta.notes, rightColWidth - 4);
                pdf.text(notesLines, rightColX + 2, rightYPos);
                rightYPos += (notesLines.length * 3.5) + 2;
            } else {
                pdf.setTextColor(180, 180, 180);
                pdf.text('(No notes provided)', rightColX + 2, rightYPos);
                pdf.setTextColor(0, 0, 0);
                rightYPos += 4;
            }
            
            // Draw separator line after each note
            pdf.setDrawColor(220, 220, 220);
            pdf.setLineWidth(0.2);
            pdf.line(rightColX, rightYPos, rightColX + rightColWidth, rightYPos);
            rightYPos += 6;
        });
        
        // Add footer with legend
        pdf.setFontSize(7);
        pdf.setTextColor(120, 120, 120);
        pdf.setFont(undefined, 'italic');
        pdf.text('Reference numbers (#1, #2, etc.) link QR codes to their corresponding notes.', pageWidth / 2, pageHeight - 8, { align: 'center' });
        
        pdf.save(`${getTimestampPrefix()}_qr-codes-printable.pdf`);
        showNotification(`Printable PDF with ${qrBucket.length} QR codes downloaded!`);
        
        if (typeof gtag !== 'undefined') {
            gtag('event', 'download_printable_pdf', {
                'count': qrBucket.length
            });
        }
    });
}

// Helper function to convert canvas to SVG
function canvasToSVG() {
    const canvas = qrCanvas;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">`;
    
    // Add white background
    svg += `<rect width="${canvas.width}" height="${canvas.height}" fill="white"/>`;
    
    // Convert pixels to rectangles (simplified approach)
    const pixelSize = 1;
    for (let y = 0; y < canvas.height; y += pixelSize) {
        for (let x = 0; x < canvas.width; x += pixelSize) {
            const i = (y * canvas.width + x) * 4;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3] / 255;
            
            // Only draw non-white pixels
            if (r < 250 || g < 250 || b < 250) {
                const color = `rgba(${r},${g},${b},${a})`;
                svg += `<rect x="${x}" y="${y}" width="${pixelSize}" height="${pixelSize}" fill="${color}"/>`;
            }
        }
    }
    
    svg += '</svg>';
    return svg;
}

// Helper function for converting any canvas to SVG (for bucket items)
function canvasToSVGFromCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">`;
    
    // Add white background
    svg += `<rect width="${canvas.width}" height="${canvas.height}" fill="white"/>`;
    
    // Convert pixels to rectangles (simplified approach)
    const pixelSize = 1;
    for (let y = 0; y < canvas.height; y += pixelSize) {
        for (let x = 0; x < canvas.width; x += pixelSize) {
            const i = (y * canvas.width + x) * 4;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3] / 255;
            
            // Only draw non-white pixels
            if (r < 250 || g < 250 || b < 250) {
                const color = `rgba(${r},${g},${b},${a})`;
                svg += `<rect x="${x}" y="${y}" width="${pixelSize}" height="${pixelSize}" fill="${color}"/>`;
            }
        }
    }
    
    svg += '</svg>';
    return svg;
}


// Clear all
clearBtn.addEventListener('click', () => {
    textInput.value = '';
    labelInput.value = '';
    if (qrNotesInput) {
        qrNotesInput.value = '';
    }
    selectedLogo = null;
    logoInput.value = '';
    logoStatus.textContent = 'No logo selected';
    logoStatus.style.color = '#888';
    sizeRange.value = 10;
    borderRange.value = 2;
    logoSizeRange.value = 25;
    labelSizeRange.value = 100;
    sizeValue.textContent = '10';
    borderValue.textContent = '2';
    logoSizeValue.textContent = '25';
    labelSizeValue.textContent = '100';
    
    const ctx = qrCanvas.getContext('2d');
    ctx.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
    qrCanvas.classList.remove('visible');
    previewPlaceholder.classList.remove('hidden');
    currentQRDataURL = null;
});

// Notification helper
function showNotification(message) {
    // Simple alert for now - you can make this fancier with a custom notification
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #4CAF50;
        color: white;
        padding: 15px 25px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 1000;
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 2000);
}

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Industry Tab Navigation
document.addEventListener('DOMContentLoaded', function() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const targetTab = this.getAttribute('data-tab');
            
            // Remove active class from all buttons and contents
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            
            // Add active class to clicked button and corresponding content
            this.classList.add('active');
            document.getElementById(`${targetTab}-tab`).classList.add('active');
            
            // Analytics: Track tab view
            if (typeof gtag !== 'undefined') {
                gtag('event', 'industry_tab_viewed', {
                    'tab_name': targetTab
                });
            }
        });
    });
});

// Print Industry Guide Function
function printIndustryGuide() {
    // Get the active tab name
    const activeTab = document.querySelector('.tab-btn.active');
    const tabName = activeTab ? activeTab.getAttribute('data-tab') : 'documentation';
    
    // Analytics: Track print
    if (typeof gtag !== 'undefined') {
        gtag('event', 'guide_printed', {
            'tab_name': tabName
        });
    }
    
    // Trigger browser print dialog
    window.print();
}

// Template Filter Function for Industry Guides
function toggleTemplate(templateElement, tabName) {
    // Toggle active state on clicked template
    templateElement.classList.toggle('active');
    templateElement.classList.toggle('inactive');
    
    // Get all active templates for this tab
    const activeTemplates = [];
    const allTemplates = document.querySelectorAll(`[data-tab="${tabName}"] .template-item`);
    
    allTemplates.forEach(template => {
        if (template.classList.contains('active')) {
            activeTemplates.push(template.getAttribute('data-template-type'));
        }
    });
    
    // If no templates are active, show all
    const showAll = activeTemplates.length === 0;
    
    // Get all use cases for this tab (static content)
    const tabContent = document.getElementById(`${tabName}-tab`);
    const useCases = tabContent.querySelectorAll('.event-template[data-templates]');
    
    useCases.forEach(useCase => {
        const useCaseTemplates = useCase.getAttribute('data-templates').split(',');
        
        // Check if this use case matches any active template
        const matches = showAll || useCaseTemplates.some(t => activeTemplates.includes(t.trim()));
        
        if (matches) {
            useCase.classList.remove('use-case-hidden');
        } else {
            useCase.classList.add('use-case-hidden');
        }
    });
    
    // ALSO filter the Use Case Examples section (the global examples grid)
    // Map data-template-type to use case example types
    const templateTypeMapping = {
        'calendar': 'event',
        'location': 'geo',
        'review': 'google-review',
        'email': 'email',
        'phone': 'phone',
        'url': 'url',
        'wifi': 'wifi',
        'vcard': 'vcard',
        'mecard': 'mecard',
        'sms': 'sms'
    };
    
    // Map active template types to example types and set as active filters
    const mappedTypes = activeTemplates.map(t => templateTypeMapping[t] || t);
    
    // Clear all existing filters on global template buttons
    document.querySelectorAll('.template-btn').forEach(btn => {
        btn.classList.remove('active-filter');
    });
    
    // Set active filters on global template buttons based on industry tab selection
    if (mappedTypes.length > 0) {
        document.querySelectorAll('.template-btn').forEach(btn => {
            if (mappedTypes.includes(btn.dataset.template)) {
                btn.classList.add('active-filter');
            }
        });
    }
    
    // Trigger use case filtering
    filterUseCases();
    
    // Analytics: Track template filter
    if (typeof gtag !== 'undefined') {
        gtag('event', 'template_filter_toggled', {
            event_action: 'toggle_template',
            tab_name: tabName,
            template_type: templateElement.getAttribute('data-template-type'),
            is_active: templateElement.classList.contains('active'),
            active_count: activeTemplates.length
        });
    }
}


// ===== INITIALIZATION =====
// Load history from localStorage on page load
loadHistoryFromLocalStorage();
// ============================================
// ARTISTIC QR CODE FUNCTIONS
// ============================================

function applyArtisticBlending(ctx, canvasWidth, canvasHeight, padding, qrSize) {
    // Save the current QR code before blending
    const qrImageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
    
    // Create a temporary canvas for the background
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = canvasWidth;
    bgCanvas.height = canvasHeight;
    const bgCtx = bgCanvas.getContext('2d');
    
    // Fill background with white
    bgCtx.fillStyle = '#ffffff';
    bgCtx.fillRect(0, 0, canvasWidth, canvasHeight);
    
    // Draw background image using cover/crop logic (maintain aspect ratio)
    const imgAspect = backgroundImage.width / backgroundImage.height;
    const canvasAspect = canvasWidth / canvasHeight;
    
    let drawWidth, drawHeight, offsetX, offsetY;
    
    if (imgAspect > canvasAspect) {
        // Image is wider - fit height, crop width
        drawHeight = canvasHeight;
        drawWidth = canvasHeight * imgAspect;
        offsetX = (canvasWidth - drawWidth) / 2;
        offsetY = 0;
    } else {
        // Image is taller - fit width, crop height
        drawWidth = canvasWidth;
        drawHeight = canvasWidth / imgAspect;
        offsetX = 0;
        offsetY = (canvasHeight - drawHeight) / 2;
    }
    
    bgCtx.drawImage(backgroundImage, offsetX, offsetY, drawWidth, drawHeight);
    
    // Get background image data
    const bgImageData = bgCtx.getImageData(0, 0, canvasWidth, canvasHeight);
    
    // Apply blending
    const qrPixels = qrImageData.data;
    const bgPixels = bgImageData.data;
    
    const bgOpacity = currentBgOpacity / 100;
    const qrOpacity = currentQrStrength / 100;
    
    for (let i = 0; i < qrPixels.length; i += 4) {
        const qrBrightness = (qrPixels[i] + qrPixels[i + 1] + qrPixels[i + 2]) / 3;
        const isQrLight = qrBrightness > 128;
        
        // Blend background with QR code
        let r, g, b;
        
        if (currentBlendMode === 'overlay') {
            // Enhanced overlay for better QR visibility
            if (isQrLight) {
                r = bgPixels[i] * bgOpacity + qrPixels[i] * (1 - bgOpacity);
                g = bgPixels[i + 1] * bgOpacity + qrPixels[i + 1] * (1 - bgOpacity);
                b = bgPixels[i + 2] * bgOpacity + qrPixels[i + 2] * (1 - bgOpacity);
            } else {
                // Keep QR dark areas strong
                r = qrPixels[i] * qrOpacity + bgPixels[i] * (1 - qrOpacity) * 0.5;
                g = qrPixels[i + 1] * qrOpacity + bgPixels[i + 1] * (1 - qrOpacity) * 0.5;
                b = qrPixels[i + 2] * qrOpacity + bgPixels[i + 2] * (1 - qrOpacity) * 0.5;
            }
        } else if (currentBlendMode === 'multiply') {
            r = (qrPixels[i] / 255) * (bgPixels[i] / 255) * 255;
            g = (qrPixels[i + 1] / 255) * (bgPixels[i + 1] / 255) * 255;
            b = (qrPixels[i + 2] / 255) * (bgPixels[i + 2] / 255) * 255;
        } else if (currentBlendMode === 'screen') {
            r = 255 - ((255 - qrPixels[i]) * (255 - bgPixels[i])) / 255;
            g = 255 - ((255 - qrPixels[i + 1]) * (255 - bgPixels[i + 1])) / 255;
            b = 255 - ((255 - qrPixels[i + 2]) * (255 - bgPixels[i + 2])) / 255;
        } else if (currentBlendMode === 'darken') {
            r = Math.min(qrPixels[i], bgPixels[i]);
            g = Math.min(qrPixels[i + 1], bgPixels[i + 1]);
            b = Math.min(qrPixels[i + 2], bgPixels[i + 2]);
        } else if (currentBlendMode === 'lighten') {
            r = Math.max(qrPixels[i], bgPixels[i]);
            g = Math.max(qrPixels[i + 1], bgPixels[i + 1]);
            b = Math.max(qrPixels[i + 2], bgPixels[i + 2]);
        } else { // normal
            r = bgPixels[i] * bgOpacity + qrPixels[i] * (1 - bgOpacity);
            g = bgPixels[i + 1] * bgOpacity + qrPixels[i + 1] * (1 - bgOpacity);
            b = bgPixels[i + 2] * bgOpacity + qrPixels[i + 2] * (1 - bgOpacity);
        }
        
        qrPixels[i] = Math.round(r);
        qrPixels[i + 1] = Math.round(g);
        qrPixels[i + 2] = Math.round(b);
    }
    
    // Put the blended image back
    ctx.putImageData(qrImageData, 0, 0);
}

function validateQRScannability() {
    updateValidationStatus('testing', 'Testing scannability...');
    
    // Use setTimeout to allow UI to update
    setTimeout(() => {
        try {
            const ctx = qrCanvas.getContext('2d');
            const imageData = ctx.getImageData(0, 0, qrCanvas.width, qrCanvas.height);
            
            // Use jsQR library to test if QR code can be read
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: "dontInvert",
            });
            
            if (code) {
                const originalText = textInput.value.trim();
                if (code.data === originalText) {
                    updateValidationStatus('valid', 'QR code is scannable! ✓');
                } else {
                    updateValidationStatus('invalid', 'QR data mismatch. Try adjusting settings.');
                }
            } else {
                // QR code not scannable - provide clickable suggestions
                const suggestions = [];
                
                // Suggestion 1: Increase QR Strength
                if (currentQrStrength < 90) {
                    suggestions.push({
                        text: '🔧 Increase QR Strength to ' + Math.min(currentQrStrength + 10, 95) + '%',
                        action: () => {
                            const newValue = Math.min(currentQrStrength + 10, 95);
                            qrStrengthRange.value = newValue;
                            qrStrengthValue.textContent = newValue;
                            currentQrStrength = newValue;
                            generateQRCode();
                        }
                    });
                }
                
                // Suggestion 2: Decrease Background Opacity
                if (currentBgOpacity > 30) {
                    suggestions.push({
                        text: '🔧 Decrease Background Opacity to ' + Math.max(currentBgOpacity - 10, 30) + '%',
                        action: () => {
                            const newValue = Math.max(currentBgOpacity - 10, 30);
                            bgOpacityRange.value = newValue;
                            bgOpacityValue.textContent = newValue;
                            currentBgOpacity = newValue;
                            generateQRCode();
                        }
                    });
                }
                
                // Suggestion 3: Change to Overlay blend mode (if not already)
                if (currentBlendMode !== 'overlay') {
                    suggestions.push({
                        text: '🔧 Switch to Overlay Blend Mode',
                        action: () => {
                            blendModeSelect.value = 'overlay';
                            currentBlendMode = 'overlay';
                            generateQRCode();
                        }
                    });
                }
                
                // Suggestion 4: Try a simpler background
                if (suggestions.length === 0) {
                    suggestions.push({
                        text: '💡 Try a simpler background image',
                        action: () => {
                            alert('Consider using:\n• Simpler patterns\n• Less detail\n• Softer gradients\n• More solid color areas');
                        }
                    });
                }
                
                updateValidationStatus('invalid', 'QR may not scan properly. Try these fixes:', suggestions);
            }
        } catch (error) {
            console.error('Validation error:', error);
            updateValidationStatus('invalid', 'Validation failed. Adjust blend settings.');
        }
    }, 100);
}