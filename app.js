// QR Code Generator Web App

// ===== CONFIGURATION =====
// Google Gemini API Key for dynamic prompt generation
const GEMINI_API_KEY = 'AIzaSyBEI6qU_1KTUDxTq6hWskFaYaJ933i3vKM';
// Google Maps API Key for inline Place ID search.
// Requires: Maps JavaScript API + Places API (New) enabled in Google Cloud Console.
const GOOGLE_MAPS_API_KEY = 'AIzaSyBEI6qU_1KTUDxTq6hWskFaYaJ933i3vKM';
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

// Privacy preference - true means user allows history saving
let privacyOptInPreference = true;
const PRIVACY_PREF_KEY = 'qr_privacy_opt_in';

// State history for undo/redo functionality
let stateHistory = [];
let currentStateIndex = -1;
const MAX_HISTORY = 50;
let isRestoringState = false; // Prevent saving during undo/redo
let historySaveTimer = null;
let hasWarnedHistoryStorageSize = false;
const MAX_HISTORY_STORAGE_CHARS = 900000; // ~0.9MB JSON budget to avoid main-thread stalls

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
    document.body.classList.add('cropper-open');
    
    // Prevent body scroll on mobile when modal is open
    document.body.style.overflow = 'hidden';
    
    // Initialize cropper
    if (cropperInstance) {
        cropperInstance.destroy();
    }
    
    // Set onload BEFORE src — data URLs can load synchronously and fire onload
    // immediately if src is set first, meaning the handler would never be called.
    cropperImage.onload = () => {
        cropperInstance = new Cropper(cropperImage, {
            aspectRatio: 1, // Always square — prevents distortion in QR overlays
            viewMode: 1,
            // Default to moving the image so users can position content inside
            // the square crop frame with normal mouse drag.
            dragMode: 'move',
            autoCropArea: 0.72,
            restore: false,
            guides: true,
            center: true,
            highlight: false,
            cropBoxMovable: false,
            cropBoxResizable: true,
            minCropBoxWidth: 48,
            minCropBoxHeight: 48,
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
            cropend: function() {
                if (!cropperIsRedrawing) {
                    return;
                }

                cropperIsRedrawing = false;
                requestAnimationFrame(() => {
                    if (cropperInstance) {
                        cropperInstance.setDragMode('move');
                    }
                });
            },
            ready: function() {
                // Start slightly inset so edge handles are easy to grab.
                const data = this.cropper.getContainerData();
                const insetX = Math.round(data.width * 0.08);
                const insetY = Math.round(data.height * 0.08);
                this.cropper.setCropBoxData({
                    left: insetX,
                    top: insetY,
                    width: Math.max(48, data.width - (insetX * 2)),
                    height: Math.max(48, data.height - (insetY * 2))
                });
                this.cropper.setDragMode('move');
            }
        });
    };
    // Assign src AFTER onload is registered so the handler is always called,
    // even if the browser resolves the data URL synchronously.
    cropperImage.src = imageDataURL;
}

function hideImageCropper() {
    cropperModal.style.display = 'none';
    document.body.classList.remove('cropper-open');
    
    // Restore body scroll
    document.body.style.overflow = '';
    
    if (cropperInstance) {
        cropperInstance.destroy();
        cropperInstance = null;
    }
    currentCropMode = null;
    pendingImageFile = null;
}

// Tracks the blob URL used for the background preview so it can be freed when replaced.
let _bgPreviewBlobURL = null;
// Tracks the active logo blob URL so preview and state save keep working.
let _logoBlobURL = null;

function applyCroppedImage() {
    if (!cropperInstance) return;

    // Logos need PNG to preserve transparency; backgrounds can use JPEG (much faster).
    const isLogo = currentCropMode === 'logo';
    // Capture state now — hideImageCropper() will null these out.
    const fileName = pendingImageFile;

    // Use native resolution — no downscaling. toBlob() is async so there's no
    // main-thread freeze risk regardless of image size.
    // Logos use PNG (lossless + transparency). Backgrounds use high-quality JPEG.
    const mimeType = isLogo ? 'image/png' : 'image/jpeg';
    const quality  = isLogo ? undefined : 0.97;

    const canvas = cropperInstance.getCroppedCanvas({
        // No maxWidth/maxHeight — let the crop reflect the original pixel density.
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
        fillColor: isLogo ? 'transparent' : '#ffffff',
    });

    if (!canvas) {
        console.error('Failed to get cropped canvas');
        return;
    }

    // Close the modal right away so the UI feels responsive.
    hideImageCropper();

    // toBlob() is async and won't block the main thread, unlike toDataURL().
    canvas.toBlob((blob) => {
        if (!blob) {
            console.error('Failed to convert cropped canvas to blob');
            return;
        }
        const blobURL = URL.createObjectURL(blob);
        const img = new Image();

        img.onload = () => {
            if (isLogo) {
                // Keep current logo URL alive for preview/history; revoke old one on replace.
                if (_logoBlobURL) {
                    URL.revokeObjectURL(_logoBlobURL);
                }
                _logoBlobURL = blobURL;
                selectedLogo = img;
                logoStatus.textContent = `Logo: ${fileName}`;
                logoStatus.style.color = '#4CAF50';
                // Show preview thumbnail
                const preview = document.getElementById('logoPreview');
                if (preview) {
                    preview.src = blobURL;
                    preview.style.display = 'block';
                }
                suggestErrorCorrectionLevel();
                if (currentQRDataURL) {
                    saveCurrentState('Added logo');
                    if (typeof gtag !== 'undefined') gtag('event', 'logo_selected');
                    generateQRCode();
                }
            } else {
                // Free the previous background blob URL before replacing it.
                if (_bgPreviewBlobURL) {
                    URL.revokeObjectURL(_bgPreviewBlobURL);
                }
                _bgPreviewBlobURL = blobURL;
                backgroundImage = img;
                bgImageStatus.textContent = `Background: ${fileName}`;
                bgImageStatus.style.color = '#4CAF50';
                bgPreviewImage.src = blobURL;
                bgPreviewSection.style.display = 'block';
                blendControlsSection.style.display = 'block';
                updateValidationStatus('idle', 'Click "Generate QR Code" to test');
                suggestErrorCorrectionLevel();
                if (typeof gtag !== 'undefined') gtag('event', 'artistic_background_uploaded');
                if (currentQRDataURL) {
                    saveCurrentState('Added artistic background');
                    generateQRCode();
                }
            }
        };

        img.src = blobURL;
    }, mimeType, quality);
}
// ---------------------------------------------------------------------

// QR Code Bucket for batch processing with metadata
let qrBucket = [];
const MAX_BUCKET_SIZE_PDF = 8;  // 2 columns × 4 rows
const MAX_BUCKET_SIZE_OTHER = 10;

// Metadata tracking for each QR code
let qrMetadataHistory = [];
let activeBucketPreviewToken = 0;

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
const aiRoadmapTeaser = document.getElementById('aiRoadmapTeaser');
const viewAiRoadmapBtn = document.getElementById('viewAiRoadmapBtn');

const ARTISTIC_CREATE_IMAGE_ENABLED = false;
const ARTISTIC_CREATE_IMAGE_ROADMAP_ID = 'ai-create-image';

if (aiModelStatus) {
    aiModelStatus.textContent = `AI model: ${workingGeminiModel}`;
}

function showCreateImageRoadmapTeaser() {
    if (aiRoadmapTeaser) {
        aiRoadmapTeaser.style.display = 'block';
    }

    if (aiImageStatus) {
        aiImageStatus.textContent = 'Create Image is a future roadmap feature.';
        aiImageStatus.style.color = '#5f6368';
    }
}

function openCreateImageRoadmapItem() {
    openIndustryTab('versions-roadmap');
    setTimeout(() => {
        const roadmapItem = document.getElementById(`roadmap-item-${ARTISTIC_CREATE_IMAGE_ROADMAP_ID}`);
        if (roadmapItem) {
            roadmapItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
            roadmapItem.style.boxShadow = '0 0 0 2px rgba(102, 126, 234, 0.25)';
            setTimeout(() => {
                roadmapItem.style.boxShadow = '';
            }, 1800);
        }
    }, 80);
}

function blockCreateImageFeatureAccess(triggerSource = 'ui') {
    if (ARTISTIC_CREATE_IMAGE_ENABLED) return false;

    uploadBgBtn.classList.add('active');
    aiBgBtn.classList.remove('active');
    uploadBgSection.style.display = 'block';
    aiBgSection.style.display = 'none';
    showCreateImageRoadmapTeaser();
    showNotification('Create Image is coming soon. See it in Versions & Roadmap.');

    if (typeof gtag !== 'undefined') {
        gtag('event', 'future_feature_clicked', {
            feature_name: 'artistic_create_image',
            source: triggerSource
        });
    }

    return true;
}

if (!ARTISTIC_CREATE_IMAGE_ENABLED) {
    [
        aiPromptInput,
        generateAiImageBtn,
        cancelAiImageBtn,
        tryBackupRendererBtn,
        togglePromptHelperBtn,
        contextInput,
        generatePromptBtn,
        retryPromptBtn
    ].forEach(el => {
        if (el) el.disabled = true;
    });

    if (aiBgSection) {
        aiBgSection.style.display = 'none';
    }
}

if (viewAiRoadmapBtn) {
    viewAiRoadmapBtn.addEventListener('click', () => {
        openCreateImageRoadmapItem();
    });
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
const wifiPrivacyNotice = document.getElementById('wifiPrivacyNotice');
const googleColorToggle = document.getElementById('googleColorToggle');
const templateFormContainer = document.getElementById('templateFormContainer');
const templateFormTitle = document.getElementById('templateFormTitle');
const templateFormFields = document.getElementById('templateFormFields');
const templatePreviewOutput = document.getElementById('templatePreviewOutput');
const rawInputContainer = document.getElementById('rawInputContainer');
const manualInputBtn = document.getElementById('manualInputBtn');
const templateFormBody = document.getElementById('templateFormBody');
const merchantSchedulePanel = document.getElementById('merchantSchedulePanel');
let activeTemplateType = null;
// Per-template data cache: { 'event': 'event-payload-string', 'phone': 'phone-payload-string', ... }
let templateDataCache = {};
let lastActiveTemplate = null;

// Merchant scheduling controls
const merchantHoursRows = document.getElementById('merchantHoursRows');
const merchantHolidays = document.getElementById('merchantHolidays');
const futureEventDate = document.getElementById('futureEventDate');
const futureEventDateWeekday = document.getElementById('futureEventDateWeekday');
const futureQuickDays = document.getElementById('futureQuickDays');
const futureQuickMonths = document.getElementById('futureQuickMonths');
const futureQuickYears = document.getElementById('futureQuickYears');
const saveMerchantScheduleBtn = document.getElementById('saveMerchantScheduleBtn');
const applyFutureSlotBtn = document.getElementById('applyFutureSlotBtn');
const downloadInviteBtn = document.getElementById('downloadInviteBtn');
const merchantScheduleStatus = document.getElementById('merchantScheduleStatus');

const MERCHANT_SCHEDULE_STORAGE_KEY = 'qr_merchant_schedule_v1';
const MERCHANT_EVENT_DRAFT_STORAGE_KEY = 'qr_merchant_event_draft_v1';
const EVENT_LOCATION_DEBUG_PREF_KEY = 'qr_event_location_debug_details_v1';
const MERCHANT_FUTURE_OFFSET_DEFAULT = { days: 0, months: 0, years: 1 };
const MERCHANT_FUTURE_OFFSET_LIMITS = {
    days: { min: 0, max: 365 },
    months: { min: 0, max: 120 },
    years: { min: 0, max: 10 }
};
const BUSINESS_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const BUSINESS_DAY_LABELS = {
    monday: 'Monday',
    tuesday: 'Tuesday',
    wednesday: 'Wednesday',
    thursday: 'Thursday',
    friday: 'Friday',
    saturday: 'Saturday',
    sunday: 'Sunday'
};
let merchantScheduleSettings = null;

const COUNTRY_DIAL_CODES = [
    { code: 'AF', dial: '+93', name: 'Afghanistan' },
    { code: 'AL', dial: '+355', name: 'Albania' },
    { code: 'DZ', dial: '+213', name: 'Algeria' },
    { code: 'AG', dial: '+1-268', name: 'Antigua & Barbuda' },
    { code: 'AR', dial: '+54', name: 'Argentina' },
    { code: 'AM', dial: '+374', name: 'Armenia' },
    { code: 'AZ', dial: '+994', name: 'Azerbaijan' },
    { code: 'BS', dial: '+1-242', name: 'Bahamas' },
    { code: 'BH', dial: '+973', name: 'Bahrain' },
    { code: 'BD', dial: '+880', name: 'Bangladesh' },
    { code: 'BB', dial: '+1-246', name: 'Barbados' },
    { code: 'BY', dial: '+375', name: 'Belarus' },
    { code: 'BE', dial: '+32', name: 'Belgium' },
    { code: 'BZ', dial: '+501', name: 'Belize' },
    { code: 'BJ', dial: '+229', name: 'Benin' },
    { code: 'BT', dial: '+975', name: 'Bhutan' },
    { code: 'BO', dial: '+591', name: 'Bolivia' },
    { code: 'BA', dial: '+387', name: 'Bosnia & Herzegovina' },
    { code: 'BW', dial: '+267', name: 'Botswana' },
    { code: 'BR', dial: '+55', name: 'Brazil' },
    { code: 'BN', dial: '+673', name: 'Brunei' },
    { code: 'BG', dial: '+359', name: 'Bulgaria' },
    { code: 'BF', dial: '+226', name: 'Burkina Faso' },
    { code: 'BI', dial: '+257', name: 'Burundi' },
    { code: 'KH', dial: '+855', name: 'Cambodia' },
    { code: 'CM', dial: '+237', name: 'Cameroon' },
    { code: 'CA', dial: '+1', name: 'Canada' },
    { code: 'CV', dial: '+238', name: 'Cape Verde' },
    { code: 'CF', dial: '+236', name: 'Central African Republic' },
    { code: 'TD', dial: '+235', name: 'Chad' },
    { code: 'CL', dial: '+56', name: 'Chile' },
    { code: 'CN', dial: '+86', name: 'China' },
    { code: 'CO', dial: '+57', name: 'Colombia' },
    { code: 'KM', dial: '+269', name: 'Comoros' },
    { code: 'CG', dial: '+242', name: 'Congo' },
    { code: 'CR', dial: '+506', name: 'Costa Rica' },
    { code: 'HR', dial: '+385', name: 'Croatia' },
    { code: 'CU', dial: '+53', name: 'Cuba' },
    { code: 'CY', dial: '+357', name: 'Cyprus' },
    { code: 'CZ', dial: '+420', name: 'Czech Republic' },
    { code: 'CD', dial: '+243', name: 'Democratic Republic of Congo' },
    { code: 'DK', dial: '+45', name: 'Denmark' },
    { code: 'DJ', dial: '+253', name: 'Djibouti' },
    { code: 'DM', dial: '+1-767', name: 'Dominica' },
    { code: 'DO', dial: '+1-809', name: 'Dominican Republic' },
    { code: 'EC', dial: '+593', name: 'Ecuador' },
    { code: 'EG', dial: '+20', name: 'Egypt' },
    { code: 'SV', dial: '+503', name: 'El Salvador' },
    { code: 'EE', dial: '+372', name: 'Estonia' },
    { code: 'ET', dial: '+251', name: 'Ethiopia' },
    { code: 'FJ', dial: '+679', name: 'Fiji' },
    { code: 'FI', dial: '+358', name: 'Finland' },
    { code: 'FR', dial: '+33', name: 'France' },
    { code: 'GA', dial: '+241', name: 'Gabon' },
    { code: 'GM', dial: '+220', name: 'Gambia' },
    { code: 'GE', dial: '+995', name: 'Georgia' },
    { code: 'DE', dial: '+49', name: 'Germany' },
    { code: 'GH', dial: '+233', name: 'Ghana' },
    { code: 'GR', dial: '+30', name: 'Greece' },
    { code: 'GD', dial: '+1-473', name: 'Grenada' },
    { code: 'GT', dial: '+502', name: 'Guatemala' },
    { code: 'GN', dial: '+224', name: 'Guinea' },
    { code: 'GW', dial: '+245', name: 'Guinea-Bissau' },
    { code: 'GY', dial: '+592', name: 'Guyana' },
    { code: 'HT', dial: '+509', name: 'Haiti' },
    { code: 'HK', dial: '+852', name: 'Hong Kong' },
    { code: 'HU', dial: '+36', name: 'Hungary' },
    { code: 'IS', dial: '+354', name: 'Iceland' },
    { code: 'IN', dial: '+91', name: 'India' },
    { code: 'ID', dial: '+62', name: 'Indonesia' },
    { code: 'IR', dial: '+98', name: 'Iran' },
    { code: 'IQ', dial: '+964', name: 'Iraq' },
    { code: 'IE', dial: '+353', name: 'Ireland' },
    { code: 'IL', dial: '+972', name: 'Israel' },
    { code: 'IT', dial: '+39', name: 'Italy' },
    { code: 'CI', dial: '+225', name: 'Ivory Coast' },
    { code: 'JM', dial: '+1-876', name: 'Jamaica' },
    { code: 'JP', dial: '+81', name: 'Japan' },
    { code: 'JO', dial: '+962', name: 'Jordan' },
    { code: 'KZ', dial: '+7', name: 'Kazakhstan' },
    { code: 'KE', dial: '+254', name: 'Kenya' },
    { code: 'KI', dial: '+686', name: 'Kiribati' },
    { code: 'KP', dial: '+850', name: 'North Korea' },
    { code: 'KR', dial: '+82', name: 'South Korea' },
    { code: 'KW', dial: '+965', name: 'Kuwait' },
    { code: 'KG', dial: '+996', name: 'Kyrgyzstan' },
    { code: 'LA', dial: '+856', name: 'Laos' },
    { code: 'LV', dial: '+371', name: 'Latvia' },
    { code: 'LB', dial: '+961', name: 'Lebanon' },
    { code: 'LS', dial: '+266', name: 'Lesotho' },
    { code: 'LR', dial: '+231', name: 'Liberia' },
    { code: 'LY', dial: '+218', name: 'Libya' },
    { code: 'LI', dial: '+423', name: 'Liechtenstein' },
    { code: 'LT', dial: '+370', name: 'Lithuania' },
    { code: 'LU', dial: '+352', name: 'Luxembourg' },
    { code: 'MO', dial: '+853', name: 'Macau' },
    { code: 'MK', dial: '+389', name: 'North Macedonia' },
    { code: 'MG', dial: '+261', name: 'Madagascar' },
    { code: 'MW', dial: '+265', name: 'Malawi' },
    { code: 'MY', dial: '+60', name: 'Malaysia' },
    { code: 'MV', dial: '+960', name: 'Maldives' },
    { code: 'ML', dial: '+223', name: 'Mali' },
    { code: 'MT', dial: '+356', name: 'Malta' },
    { code: 'MH', dial: '+692', name: 'Marshall Islands' },
    { code: 'MR', dial: '+222', name: 'Mauritania' },
    { code: 'MU', dial: '+230', name: 'Mauritius' },
    { code: 'MX', dial: '+52', name: 'Mexico' },
    { code: 'FM', dial: '+691', name: 'Micronesia' },
    { code: 'MD', dial: '+373', name: 'Moldova' },
    { code: 'MC', dial: '+377', name: 'Monaco' },
    { code: 'MN', dial: '+976', name: 'Mongolia' },
    { code: 'ME', dial: '+382', name: 'Montenegro' },
    { code: 'MA', dial: '+212', name: 'Morocco' },
    { code: 'MZ', dial: '+258', name: 'Mozambique' },
    { code: 'MM', dial: '+95', name: 'Myanmar' },
    { code: 'NA', dial: '+264', name: 'Namibia' },
    { code: 'NR', dial: '+674', name: 'Nauru' },
    { code: 'NP', dial: '+977', name: 'Nepal' },
    { code: 'NL', dial: '+31', name: 'Netherlands' },
    { code: 'NZ', dial: '+64', name: 'New Zealand' },
    { code: 'NI', dial: '+505', name: 'Nicaragua' },
    { code: 'NE', dial: '+227', name: 'Niger' },
    { code: 'NG', dial: '+234', name: 'Nigeria' },
    { code: 'NO', dial: '+47', name: 'Norway' },
    { code: 'OM', dial: '+968', name: 'Oman' },
    { code: 'PK', dial: '+92', name: 'Pakistan' },
    { code: 'PW', dial: '+680', name: 'Palau' },
    { code: 'PA', dial: '+507', name: 'Panama' },
    { code: 'PG', dial: '+675', name: 'Papua New Guinea' },
    { code: 'PY', dial: '+595', name: 'Paraguay' },
    { code: 'PE', dial: '+51', name: 'Peru' },
    { code: 'PH', dial: '+63', name: 'Philippines' },
    { code: 'PL', dial: '+48', name: 'Poland' },
    { code: 'PT', dial: '+351', name: 'Portugal' },
    { code: 'QA', dial: '+974', name: 'Qatar' },
    { code: 'RO', dial: '+40', name: 'Romania' },
    { code: 'RU', dial: '+7', name: 'Russia' },
    { code: 'RW', dial: '+250', name: 'Rwanda' },
    { code: 'KN', dial: '+1-869', name: 'St Kitts & Nevis' },
    { code: 'LC', dial: '+1-758', name: 'St Lucia' },
    { code: 'VC', dial: '+1-784', name: 'St Vincent & Grenadines' },
    { code: 'WS', dial: '+685', name: 'Samoa' },
    { code: 'SM', dial: '+378', name: 'San Marino' },
    { code: 'ST', dial: '+239', name: 'São Tomé & Príncipe' },
    { code: 'SA', dial: '+966', name: 'Saudi Arabia' },
    { code: 'SN', dial: '+221', name: 'Senegal' },
    { code: 'RS', dial: '+381', name: 'Serbia' },
    { code: 'SC', dial: '+248', name: 'Seychelles' },
    { code: 'SL', dial: '+232', name: 'Sierra Leone' },
    { code: 'SG', dial: '+65', name: 'Singapore' },
    { code: 'SK', dial: '+421', name: 'Slovakia' },
    { code: 'SI', dial: '+386', name: 'Slovenia' },
    { code: 'SB', dial: '+677', name: 'Solomon Islands' },
    { code: 'SO', dial: '+252', name: 'Somalia' },
    { code: 'ZA', dial: '+27', name: 'South Africa' },
    { code: 'SS', dial: '+211', name: 'South Sudan' },
    { code: 'ES', dial: '+34', name: 'Spain' },
    { code: 'LK', dial: '+94', name: 'Sri Lanka' },
    { code: 'SD', dial: '+249', name: 'Sudan' },
    { code: 'SR', dial: '+597', name: 'Suriname' },
    { code: 'SE', dial: '+46', name: 'Sweden' },
    { code: 'CH', dial: '+41', name: 'Switzerland' },
    { code: 'SY', dial: '+963', name: 'Syria' },
    { code: 'TW', dial: '+886', name: 'Taiwan' },
    { code: 'TJ', dial: '+992', name: 'Tajikistan' },
    { code: 'TZ', dial: '+255', name: 'Tanzania' },
    { code: 'TH', dial: '+66', name: 'Thailand' },
    { code: 'TL', dial: '+670', name: 'East Timor' },
    { code: 'TG', dial: '+228', name: 'Togo' },
    { code: 'TO', dial: '+676', name: 'Tonga' },
    { code: 'TT', dial: '+1-868', name: 'Trinidad & Tobago' },
    { code: 'TN', dial: '+216', name: 'Tunisia' },
    { code: 'TR', dial: '+90', name: 'Turkey' },
    { code: 'TM', dial: '+993', name: 'Turkmenistan' },
    { code: 'TV', dial: '+688', name: 'Tuvalu' },
    { code: 'UG', dial: '+256', name: 'Uganda' },
    { code: 'UA', dial: '+380', name: 'Ukraine' },
    { code: 'AE', dial: '+971', name: 'United Arab Emirates' },
    { code: 'GB', dial: '+44', name: 'United Kingdom' },
    { code: 'US', dial: '+1', name: 'United States' },
    { code: 'UY', dial: '+598', name: 'Uruguay' },
    { code: 'UZ', dial: '+998', name: 'Uzbekistan' },
    { code: 'VU', dial: '+678', name: 'Vanuatu' },
    { code: 'VE', dial: '+58', name: 'Venezuela' },
    { code: 'VN', dial: '+84', name: 'Vietnam' },
    { code: 'YE', dial: '+967', name: 'Yemen' },
    { code: 'ZM', dial: '+260', name: 'Zambia' },
    { code: 'ZW', dial: '+263', name: 'Zimbabwe' },
];

function detectDialCode() {
    const langs = [...(navigator.languages || []), navigator.language || ''];
    for (const lang of langs) {
        const country = lang.split('-')[1]?.toUpperCase();
        if (!country) continue;
        const found = COUNTRY_DIAL_CODES.find(c => c.code === country);
        if (found) return found.dial;
    }
    return '+1';
}

function splitPhoneNumber(full) {
    if (!full) return { dial: detectDialCode(), local: '' };
    if (!full.startsWith('+')) return { dial: detectDialCode(), local: full };
    const sorted = [...COUNTRY_DIAL_CODES].sort((a, b) => b.dial.length - a.dial.length);
    for (const c of sorted) {
        if (full.startsWith(c.dial)) return { dial: c.dial, local: full.slice(c.dial.length) };
    }
    const match = full.match(/^(\+\d{1,4})(.*)/);
    return match ? { dial: match[1], local: match[2] } : { dial: detectDialCode(), local: full };
}

const TEMPLATE_FORM_SCHEMAS = {
    'google-review': {
        title: 'Google Review Template',
        fields: [
            { name: 'placeId', label: 'Google Place ID', type: 'text', required: true, placeholder: 'ChIJN1t_tDeuEmsRUsoyG83frY4', default: '' }
        ]
    },
    url: {
        title: 'URL Template',
        fields: [
            { name: 'url', label: 'Website URL', type: 'url', required: true, placeholder: 'https://example.com', default: 'https://' }
        ]
    },
    email: {
        title: 'Email Template',
        fields: [
            { name: 'email', label: 'Email Address', type: 'email', required: true, placeholder: 'hello@example.com', default: 'hello@example.com' },
            { name: 'subject', label: 'Subject (optional)', type: 'text', placeholder: 'Product inquiry', default: '' },
            { name: 'body', label: 'Body (optional)', type: 'textarea', placeholder: 'Hello, I would like to ask about...', default: '' }
        ]
    },
    phone: {
        title: 'Phone Template',
        fields: [
            { name: 'phone', label: 'Phone Number', type: 'tel-country', required: true }
        ]
    },
    sms: {
        title: 'SMS Template',
        fields: [
            { name: 'phone', label: 'Phone Number', type: 'tel-country', required: true },
            { name: 'message', label: 'Message Body', type: 'textarea', placeholder: 'Your message here', default: '' }
        ]
    },
    wifi: {
        title: 'WiFi Template',
        fields: [
            { name: 'security', label: 'Security Type', type: 'select', default: 'WPA', options: [
                { value: 'WPA', label: 'WPA/WPA2' },
                { value: 'WEP', label: 'WEP' },
                { value: 'nopass', label: 'No Password' }
            ] },
            { name: 'ssid', label: 'Network Name (SSID)', type: 'text', required: true, placeholder: 'GuestNetwork', default: '' },
            { name: 'password', label: 'Password', type: 'text', placeholder: 'Welcome123', default: '' },
            { name: 'hidden', label: 'Hidden network', type: 'checkbox', default: false }
        ]
    },
    vcard: {
        title: 'vCard Template',
        fields: [
            { name: 'fullName', label: 'Full Name', type: 'text', required: true, placeholder: 'Jane Smith', default: '' },
            { name: 'phone', label: 'Phone', type: 'tel', placeholder: '+1234567890', default: '' },
            { name: 'email', label: 'Email', type: 'email', placeholder: 'jane@company.com', default: '' },
            { name: 'org', label: 'Organization', type: 'text', placeholder: 'Company Name', default: '' },
            { name: 'title', label: 'Job Title', type: 'text', placeholder: 'Marketing Manager', default: '' },
            { name: 'url', label: 'Website (optional)', type: 'url', placeholder: 'https://example.com', default: '' }
        ]
    },
    mecard: {
        title: 'MECARD Template',
        fields: [
            { name: 'lastName', label: 'Last Name', type: 'text', required: true, placeholder: 'Smith', default: '' },
            { name: 'firstName', label: 'First Name', type: 'text', required: true, placeholder: 'Jane', default: '' },
            { name: 'phone', label: 'Phone', type: 'tel', placeholder: '+1234567890', default: '' },
            { name: 'email', label: 'Email', type: 'email', placeholder: 'jane@company.com', default: '' },
            { name: 'url', label: 'Website (optional)', type: 'url', placeholder: 'https://example.com', default: '' }
        ]
    },
    event: {
        title: 'Calendar Event Template',
        fields: [
            { name: 'summary', label: 'Event Title', type: 'text', required: true, placeholder: 'Event Title', default: '' },
            { name: 'start', label: 'Start Date & Time', type: 'datetime-local', required: true, default: '' },
            { name: 'end', label: 'End Date & Time', type: 'datetime-local', required: true, default: '' },
            { name: 'location', label: 'Location', type: 'text', placeholder: 'Event Location', default: '' },
            { name: 'locationPlaceId', type: 'hidden', default: '' },
            { name: 'description', label: 'Description (optional)', type: 'textarea', placeholder: 'Event description', default: '' }
        ]
    },
    'merchant-future-event': {
        title: 'Merchant Future Event Template',
        fields: [
            { name: 'summary', label: 'Event Title', type: 'text', required: true, placeholder: 'Merchant Event Title', default: '' },
            { name: 'futureDate', label: 'Future Date', type: 'date', required: true, default: '' },
            { name: 'location', label: 'Location', type: 'text', placeholder: 'Merchant Location', default: '' },
            { name: 'locationPlaceId', type: 'hidden', default: '' },
            { name: 'description', label: 'Description (optional)', type: 'textarea', placeholder: 'Future merchant event details', default: '' }
        ]
    },
    geo: {
        title: 'Location Template',
        fields: [
            { name: 'lat', label: 'Latitude', type: 'number', required: true, step: 'any', placeholder: '37.7749', default: '' },
            { name: 'lng', label: 'Longitude', type: 'number', required: true, step: 'any', placeholder: '-122.4194', default: '' },
            { name: 'alt', label: 'Altitude in meters (optional)', type: 'number', step: 'any', placeholder: '100', default: '' }
        ]
    }
};

function trimMultilineValue(value) {
    return (value || '').replace(/\r?\n/g, ' ').trim();
}

function extractDialLinksFromText(text) {
    const source = String(text || '');
    const matches = source.match(/\+?[\d][\d\s().-]{5,}[\d]/g) || [];
    const links = [];
    const seen = new Set();

    matches.forEach(raw => {
        const trimmed = raw.trim();
        const startsWithPlus = trimmed.startsWith('+');
        const digits = trimmed.replace(/\D/g, '');
        if (digits.length < 7) return;

        const dialNumber = startsWithPlus ? `+${digits}` : digits;
        const link = `tel:${dialNumber}`;
        if (seen.has(link)) return;
        seen.add(link);
        links.push(link);
    });

    return links;
}

function buildEventDescriptionWithCallLinks(description) {
    const marker = 'Call options:';
    const baseRaw = trimMultilineValue(description || '');
    const markerIndex = baseRaw.indexOf(marker);
    const base = markerIndex >= 0 ? baseRaw.slice(0, markerIndex).trim() : baseRaw;
    const dialLinks = extractDialLinksFromText(base);

    if (!dialLinks.length) return base;
    const callSuffix = `${marker} ${dialLinks.join(' | ')}`;
    return base ? `${base} ${callSuffix}` : callSuffix;
}

async function fetchPlacePhoneNumber(placeId) {
    if (!placeId || !window.google || !google.maps || !google.maps.places || !google.maps.places.Place) {
        return { phone: '', status: 'unavailable' };
    }

    try {
        const place = new google.maps.places.Place({ id: placeId });
        await place.fetchFields({ fields: ['internationalPhoneNumber', 'nationalPhoneNumber'] });
        const phone = (place.internationalPhoneNumber || place.nationalPhoneNumber || '').trim();
        return {
            phone,
            status: phone ? 'found' : 'not-published'
        };
    } catch (error) {
        console.warn('Could not fetch place phone number:', error);
        const errorText = String((error && error.message) || '').toLowerCase();
        const isApiRestricted =
            errorText.includes('permission_denied')
            || errorText.includes('unregistered callers')
            || errorText.includes('request denied')
            || errorText.includes('api key')
            || errorText.includes('forbidden')
            || errorText.includes('403');

        return {
            phone: '',
            status: isApiRestricted ? 'api-blocked' : 'lookup-failed'
        };
    }
}

function addPlacePhoneToDescriptionField(phone) {
    if (!templateFormFields || !phone) return false;

    const descriptionEl = templateFormFields.querySelector('[name="tpl-description"]');
    if (!descriptionEl) return false;

    const current = String(descriptionEl.value || '');
    const telLink = extractDialLinksFromText(phone)[0] || '';
    const phoneLine = `Phone: ${phone}`;
    const telLine = telLink ? `Tap to call: ${telLink}` : '';

    if (current.includes(phoneLine) || (telLine && current.includes(telLine))) {
        return false;
    }

    const next = [current.trim(), phoneLine, telLine].filter(Boolean).join('\n');
    descriptionEl.value = next;
    syncPayloadFromTemplateForm();
    return true;
}

function hasPhoneDataInDescriptionField() {
    if (!templateFormFields) return false;
    const descriptionEl = templateFormFields.querySelector('[name="tpl-description"]');
    if (!descriptionEl) return false;
    const text = String(descriptionEl.value || '');
    return text.includes('Phone:') || text.includes('Tap to call:') || extractDialLinksFromText(text).length > 0;
}

function loadEventLocationDebugPreference() {
    try {
        return localStorage.getItem(EVENT_LOCATION_DEBUG_PREF_KEY) === 'true';
    } catch (_error) {
        return false;
    }
}

function persistEventLocationDebugPreference(enabled) {
    try {
        localStorage.setItem(EVENT_LOCATION_DEBUG_PREF_KEY, enabled ? 'true' : 'false');
    } catch (_error) {
        // Ignore persistence issues for this optional UI preference.
    }
}

function escapeWifiValue(value) {
    return (value || '').replace(/([\\;,:"])/g, '\\$1');
}

function unescapeWifiValue(value) {
    return (value || '').replace(/\\([\\;,:"])/g, '$1');
}

function formatDateForIcs(dateInput) {
    if (!dateInput) return '';
    const date = new Date(dateInput);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function parseIcsToLocalDate(icsDate) {
    if (!icsDate || !/^\d{8}T\d{6}Z$/.test(icsDate)) return '';
    const normalized = `${icsDate.slice(0, 4)}-${icsDate.slice(4, 6)}-${icsDate.slice(6, 8)}T${icsDate.slice(9, 11)}:${icsDate.slice(11, 13)}`;
    return normalized;
}

function toLocalDateTimeValue(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
    return local.toISOString().slice(0, 16);
}

function getFutureEventDefaults() {
    const start = new Date();
    start.setFullYear(start.getFullYear() + 1);
    start.setHours(10, 0, 0, 0);
    const end = new Date(start.getTime() + (10 * 60 * 1000));
    return {
        start: toLocalDateTimeValue(start),
        end: toLocalDateTimeValue(end)
    };
}

function toLocalDateValue(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
    return local.toISOString().slice(0, 10);
}

function parseOffsetValue(value, key) {
    const limits = MERCHANT_FUTURE_OFFSET_LIMITS[key];
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    if (Number.isNaN(parsed)) return MERCHANT_FUTURE_OFFSET_DEFAULT[key];
    return Math.min(limits.max, Math.max(limits.min, parsed));
}

function normalizeFutureOffset(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    return {
        days: parseOffsetValue(input.days, 'days'),
        months: parseOffsetValue(input.months, 'months'),
        years: parseOffsetValue(input.years, 'years')
    };
}

function addOffsetToDate(baseDate, offset) {
    const out = new Date(baseDate);
    out.setHours(0, 0, 0, 0);
    out.setDate(out.getDate() + offset.days);
    out.setMonth(out.getMonth() + offset.months);
    out.setFullYear(out.getFullYear() + offset.years);
    return out;
}

function resolveBusinessDateSlot(dateValue, settings) {
    const sourceDate = new Date(`${dateValue}T00:00:00`);
    if (Number.isNaN(sourceDate.getTime())) return null;

    const safeSettings = settings || createDefaultMerchantSchedule();
    const holidaySet = new Set(safeSettings.holidays || []);
    const cursor = new Date(sourceDate);
    cursor.setHours(0, 0, 0, 0);

    for (let offset = 0; offset < 370; offset++) {
        const dateKey = formatLocalDateKey(cursor);
        const dayName = getDayNameFromDate(cursor);
        const daySchedule = safeSettings.businessHours && safeSettings.businessHours[dayName];

        if (!daySchedule || daySchedule.closed || holidaySet.has(dateKey)) {
            cursor.setDate(cursor.getDate() + 1);
            continue;
        }

        const openMinutes = parseTimeToMinutes(daySchedule.open);
        const closeMinutes = parseTimeToMinutes(daySchedule.close);
        if (openMinutes === null || closeMinutes === null || closeMinutes <= openMinutes) {
            cursor.setDate(cursor.getDate() + 1);
            continue;
        }

        const start = new Date(cursor);
        start.setHours(Math.floor(openMinutes / 60), openMinutes % 60, 0, 0);

        const slotLengthMinutes = Math.min(10, Math.max(1, closeMinutes - openMinutes));
        const end = new Date(start.getTime() + (slotLengthMinutes * 60000));
        const closeBoundary = new Date(cursor);
        closeBoundary.setHours(Math.floor(closeMinutes / 60), closeMinutes % 60, 0, 0);
        if (end > closeBoundary) {
            end.setTime(closeBoundary.getTime());
        }

        if (end <= start) {
            cursor.setDate(cursor.getDate() + 1);
            continue;
        }

        return {
            requestedDate: dateValue,
            resolvedDate: dateKey,
            start: toLocalDateTimeValue(start),
            end: toLocalDateTimeValue(end),
            shiftedDays: offset,
            dayName
        };
    }

    return null;
}

function createDefaultMerchantSchedule() {
    const futureDefaults = getFutureEventDefaults();
    const businessHours = {};

    BUSINESS_DAYS.forEach(day => {
        const isWeekend = day === 'saturday' || day === 'sunday';
        businessHours[day] = {
            closed: isWeekend,
            open: '09:00',
            close: '17:00'
        };
    });

    return {
        businessHours,
        holidays: [],
        scheduledStart: futureDefaults.start,
        scheduledEnd: futureDefaults.end,
        scheduledDate: toLocalDateValue(new Date(futureDefaults.start)),
        futureOffset: { ...MERCHANT_FUTURE_OFFSET_DEFAULT }
    };
}

function normalizeTimeValue(value, fallback) {
    const text = (value || '').trim();
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(text) ? text : fallback;
}

function normalizeHolidayList(value) {
    if (!value) return [];

    const parts = Array.isArray(value)
        ? value
        : String(value)
            .split(/[\n,;]+/)
            .map(v => v.trim());

    const unique = new Set();
    parts.forEach(entry => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(entry)) {
            unique.add(entry);
        }
    });
    return Array.from(unique).sort();
}

function normalizeMerchantSchedule(raw) {
    const fallback = createDefaultMerchantSchedule();
    const input = raw && typeof raw === 'object' ? raw : {};
    const normalizedHours = {};

    BUSINESS_DAYS.forEach(day => {
        const dayInput = input.businessHours && input.businessHours[day] ? input.businessHours[day] : {};
        normalizedHours[day] = {
            closed: !!dayInput.closed,
            open: normalizeTimeValue(dayInput.open, '09:00'),
            close: normalizeTimeValue(dayInput.close, '17:00')
        };
    });

    const startCandidate = String(input.scheduledStart || '').trim();
    const endCandidate = String(input.scheduledEnd || '').trim();
    const dateCandidate = String(input.scheduledDate || '').trim();
    const normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateCandidate)
        ? dateCandidate
        : (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startCandidate)
            ? startCandidate.slice(0, 10)
            : toLocalDateValue(new Date(fallback.scheduledStart)));

    const derivedOffset = normalizeFutureOffset(input.futureOffset || MERCHANT_FUTURE_OFFSET_DEFAULT);
    const derivedRange = resolveBusinessDateSlot(normalizedDate, {
        businessHours: normalizedHours,
        holidays: normalizeHolidayList(input.holidays)
    }) || getFutureEventDefaults();

    return {
        businessHours: normalizedHours,
        holidays: normalizeHolidayList(input.holidays),
        scheduledStart: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startCandidate) ? startCandidate : derivedRange.start,
        scheduledEnd: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(endCandidate) ? endCandidate : derivedRange.end,
        scheduledDate: normalizedDate,
        futureOffset: derivedOffset
    };
}

function loadMerchantScheduleSettings() {
    try {
        const raw = localStorage.getItem(MERCHANT_SCHEDULE_STORAGE_KEY);
        if (!raw) return createDefaultMerchantSchedule();
        return normalizeMerchantSchedule(JSON.parse(raw));
    } catch (error) {
        console.error('Failed to load merchant schedule settings:', error);
        return createDefaultMerchantSchedule();
    }
}

function persistMerchantScheduleSettings() {
    if (!merchantScheduleSettings) return;
    try {
        localStorage.setItem(MERCHANT_SCHEDULE_STORAGE_KEY, JSON.stringify(merchantScheduleSettings));
    } catch (error) {
        console.error('Failed to persist merchant schedule settings:', error);
    }
}

function normalizeMerchantEventDraft(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const futureDateCandidate = String(input.futureDate || '').trim();
    return {
        summary: trimMultilineValue(input.summary || ''),
        location: trimMultilineValue(input.location || ''),
        locationPlaceId: trimMultilineValue(input.locationPlaceId || ''),
        description: String(input.description || '').trim(),
        futureDate: /^\d{4}-\d{2}-\d{2}$/.test(futureDateCandidate) ? futureDateCandidate : ''
    };
}

function loadMerchantEventDraft() {
    try {
        const raw = localStorage.getItem(MERCHANT_EVENT_DRAFT_STORAGE_KEY);
        if (!raw) return normalizeMerchantEventDraft({});
        return normalizeMerchantEventDraft(JSON.parse(raw));
    } catch (error) {
        console.error('Failed to load merchant event draft:', error);
        return normalizeMerchantEventDraft({});
    }
}

function persistMerchantEventDraft(values) {
    try {
        const normalized = normalizeMerchantEventDraft(values);
        localStorage.setItem(MERCHANT_EVENT_DRAFT_STORAGE_KEY, JSON.stringify(normalized));
    } catch (error) {
        console.error('Failed to persist merchant event draft:', error);
    }
}

function formatLocalDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getDayNameFromDate(date) {
    return BUSINESS_DAYS[(date.getDay() + 6) % 7];
}

function getMinutesOfDay(date) {
    return (date.getHours() * 60) + date.getMinutes();
}

function parseTimeToMinutes(timeValue) {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeValue || '');
    if (!match) return null;
    return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

function validateEventTimingForMerchant(values) {
    const startDate = new Date(values.start || '');
    const endDate = new Date(values.end || '');

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        return { valid: false, message: 'Event start/end date is invalid.' };
    }

    if (endDate <= startDate) {
        return { valid: false, message: 'Event end must be after event start.' };
    }

    const settings = merchantScheduleSettings || createDefaultMerchantSchedule();
    const holidaySet = new Set(settings.holidays || []);

    const dayCursor = new Date(startDate);
    dayCursor.setHours(0, 0, 0, 0);
    const dayEnd = new Date(endDate);
    dayEnd.setHours(0, 0, 0, 0);

    while (dayCursor <= dayEnd) {
        const dateKey = formatLocalDateKey(dayCursor);
        const dayName = getDayNameFromDate(dayCursor);
        const daySchedule = settings.businessHours[dayName];

        if (holidaySet.has(dateKey)) {
            return {
                valid: false,
                message: `This event is scheduled on a holiday closure (${dateKey}). Update holiday settings or choose another date.`
            };
        }

        if (!daySchedule || daySchedule.closed) {
            return {
                valid: false,
                message: `This event touches ${BUSINESS_DAY_LABELS[dayName]}, which is marked closed in merchant hours.`
            };
        }

        dayCursor.setDate(dayCursor.getDate() + 1);
    }

    const startDayName = getDayNameFromDate(startDate);
    const endDayName = getDayNameFromDate(endDate);
    const startDaySchedule = settings.businessHours[startDayName];
    const endDaySchedule = settings.businessHours[endDayName];
    const startOpen = parseTimeToMinutes(startDaySchedule.open);
    const startClose = parseTimeToMinutes(startDaySchedule.close);
    const endOpen = parseTimeToMinutes(endDaySchedule.open);
    const endClose = parseTimeToMinutes(endDaySchedule.close);
    const startMinutes = getMinutesOfDay(startDate);
    const endMinutes = getMinutesOfDay(endDate);

    if (startOpen === null || startClose === null || endOpen === null || endClose === null) {
        return { valid: false, message: 'Merchant hours contain an invalid time value.' };
    }

    if (startMinutes < startOpen || startMinutes >= startClose) {
        return {
            valid: false,
            message: `${BUSINESS_DAY_LABELS[startDayName]} opens at ${startDaySchedule.open} and closes at ${startDaySchedule.close}. Your start time is outside those hours.`
        };
    }

    if (endMinutes > endClose || endMinutes <= endOpen) {
        return {
            valid: false,
            message: `${BUSINESS_DAY_LABELS[endDayName]} opens at ${endDaySchedule.open} and closes at ${endDaySchedule.close}. Your end time is outside those hours.`
        };
    }

    return { valid: true, message: '' };
}

function buildCalendarInviteContent(values) {
    const uid = `qr-${Date.now()}@merchant-schedule`;
    const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const summary = trimMultilineValue(values.summary || 'Scheduled Merchant Event');
    const location = trimMultilineValue(values.location || '');
    const description = buildEventDescriptionWithCallLinks(values.description || '');

    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//QR Code Generator//Merchant Schedule//EN',
        'CALSCALE:GREGORIAN',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${stamp}`,
        `SUMMARY:${summary}`,
        `DTSTART:${formatDateForIcs(values.start)}`,
        `DTEND:${formatDateForIcs(values.end)}`,
        `LOCATION:${location}`,
        `DESCRIPTION:${description}`,
        'END:VEVENT',
        'END:VCALENDAR'
    ];

    return lines.join('\r\n');
}

function downloadCalendarInvite(values) {
    const text = buildCalendarInviteContent(values);
    const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `merchant-invite-${Date.now()}.ics`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}

function buildGoogleMapsPlaceUrl(placeId, query = '') {
    const params = new URLSearchParams({
        api: '1',
        query: (query || 'Google Maps').trim(),
        query_place_id: (placeId || '').trim()
    });
    return `https://www.google.com/maps/search/?${params.toString()}`;
}

function updateTemplatePreview(payload) {
    if (!templatePreviewOutput) return;
    templatePreviewOutput.textContent = payload || '';
}

function readTemplateFormValues(template) {
    const schema = TEMPLATE_FORM_SCHEMAS[template];
    if (!schema || !templateFormFields) return {};

    const values = {};
    schema.fields.forEach(field => {
        if (field.type === 'tel-country') {
            const dialEl = templateFormFields.querySelector(`[name="tpl-${field.name}-country"]`);
            const localEl = templateFormFields.querySelector(`[name="tpl-${field.name}-local"]`);
            const dial = (dialEl ? dialEl.value.trim() : '') || detectDialCode();
            const local = (localEl ? localEl.value.trim() : '');
            values[field.name] = local ? `${dial}${local}` : '';
            return;
        }
        const fieldEl = templateFormFields.querySelector(`[name="tpl-${field.name}"]`);
        if (!fieldEl) {
            values[field.name] = field.default || '';
            return;
        }
        values[field.name] = field.type === 'checkbox' ? fieldEl.checked : fieldEl.value.trim();
    });

    return values;
}

function buildPayloadFromTemplate(template, values) {
    switch (template) {
        case 'google-review':
            return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(values.placeId || '')}`;
        case 'url':
            return values.url || 'https://';
        case 'email': {
            const email = (values.email || '').trim();
            const params = new URLSearchParams();
            if (values.subject) params.set('subject', values.subject);
            if (values.body) params.set('body', values.body);
            const query = params.toString();
            return `mailto:${email}${query ? `?${query}` : ''}`;
        }
        case 'phone':
            return `tel:${(values.phone || '').trim()}`;
        case 'sms': {
            const phone = (values.phone || '').trim();
            const body = (values.message || '').trim();
            return `sms:${phone}${body ? `?body=${encodeURIComponent(body)}` : ''}`;
        }
        case 'wifi': {
            const security = values.security || 'WPA';
            const ssid = escapeWifiValue(values.ssid || '');
            const hidden = values.hidden ? ';H:true' : '';
            if (security === 'nopass') {
                return `WIFI:T:nopass;S:${ssid}${hidden};;`;
            }
            const password = escapeWifiValue(values.password || '');
            return `WIFI:T:${security};S:${ssid};P:${password}${hidden};;`;
        }
        case 'vcard': {
            const lines = [
                'BEGIN:VCARD',
                'VERSION:3.0',
                `FN:${trimMultilineValue(values.fullName)}`
            ];
            if (values.phone) lines.push(`TEL:${trimMultilineValue(values.phone)}`);
            if (values.email) lines.push(`EMAIL:${trimMultilineValue(values.email)}`);
            if (values.org) lines.push(`ORG:${trimMultilineValue(values.org)}`);
            if (values.title) lines.push(`TITLE:${trimMultilineValue(values.title)}`);
            if (values.url) lines.push(`URL:${trimMultilineValue(values.url)}`);
            lines.push('END:VCARD');
            return lines.join('\n');
        }
        case 'mecard': {
            const pieces = [
                `N:${trimMultilineValue(values.lastName)},${trimMultilineValue(values.firstName)}`
            ];
            if (values.phone) pieces.push(`TEL:${trimMultilineValue(values.phone)}`);
            if (values.email) pieces.push(`EMAIL:${trimMultilineValue(values.email)}`);
            if (values.url) pieces.push(`URL:${trimMultilineValue(values.url)}`);
            return `MECARD:${pieces.join(';')};;`;
        }
        case 'event': {
            const lines = [
                'BEGIN:VEVENT',
                `SUMMARY:${trimMultilineValue(values.summary)}`,
                `DTSTART:${formatDateForIcs(values.start)}`,
                `DTEND:${formatDateForIcs(values.end)}`
            ];
            lines.push(`LOCATION:${trimMultilineValue(values.location)}`);
            if (values.locationPlaceId) {
                lines.push(`URL:${buildGoogleMapsPlaceUrl(values.locationPlaceId, values.location || 'Google Maps')}`);
            }
            lines.push(`DESCRIPTION:${buildEventDescriptionWithCallLinks(values.description)}`);
            lines.push('END:VEVENT');
            return lines.join('\n');
        }
        case 'merchant-future-event': {
            const slot = resolveBusinessDateSlot(values.futureDate, merchantScheduleSettings || loadMerchantScheduleSettings());
            const start = slot ? slot.start : '';
            const end = slot ? slot.end : '';
            const lines = [
                'BEGIN:VEVENT',
                `SUMMARY:${trimMultilineValue(values.summary)}`,
                `DTSTART:${formatDateForIcs(start)}`,
                `DTEND:${formatDateForIcs(end)}`
            ];
            lines.push(`LOCATION:${trimMultilineValue(values.location)}`);
            if (values.locationPlaceId) {
                lines.push(`URL:${buildGoogleMapsPlaceUrl(values.locationPlaceId, values.location || 'Google Maps')}`);
            }
            lines.push(`DESCRIPTION:${buildEventDescriptionWithCallLinks(values.description)}`);
            lines.push('END:VEVENT');
            return lines.join('\n');
        }
        case 'geo': {
            const lat = (values.lat || '').toString().trim();
            const lng = (values.lng || '').toString().trim();
            const alt = (values.alt || '').toString().trim();
            return alt ? `geo:${lat},${lng},${alt}` : `geo:${lat},${lng}`;
        }
        default:
            return textInput.value;
    }
}

function parseTemplatePayload(template, payload) {
    const text = (payload || '').trim();
    const values = {};

    switch (template) {
        case 'google-review': {
            try {
                const url = new URL(text);
                values.placeId = url.searchParams.get('placeid') || '';
            } catch (_error) {
                values.placeId = '';
            }
            break;
        }
        case 'url':
            values.url = text;
            break;
        case 'email': {
            if (!/^mailto:/i.test(text)) break;
            const raw = text.replace(/^mailto:/i, '');
            const [emailPart, queryPart] = raw.split('?');
            const params = new URLSearchParams(queryPart || '');
            values.email = decodeURIComponent(emailPart || '');
            values.subject = params.get('subject') || '';
            values.body = params.get('body') || '';
            break;
        }
        case 'phone':
            values.phone = text.replace(/^tel:/i, '');
            break;
        case 'sms': {
            const raw = text.replace(/^sms:/i, '');
            const [phonePart, queryPart] = raw.split('?');
            const params = new URLSearchParams(queryPart || '');
            values.phone = phonePart || '';
            values.message = params.get('body') || '';
            break;
        }
        case 'wifi': {
            const body = text.replace(/^WIFI:/i, '').replace(/;;$/, ';');
            const chunks = body.split(';').filter(Boolean);
            chunks.forEach(chunk => {
                const sepIndex = chunk.indexOf(':');
                if (sepIndex === -1) return;
                const key = chunk.slice(0, sepIndex);
                const rawValue = chunk.slice(sepIndex + 1);
                if (key === 'T') values.security = rawValue || 'WPA';
                if (key === 'S') values.ssid = unescapeWifiValue(rawValue);
                if (key === 'P') values.password = unescapeWifiValue(rawValue);
                if (key === 'H') values.hidden = rawValue.toLowerCase() === 'true';
            });
            break;
        }
        case 'vcard': {
            text.split(/\r?\n/).forEach(line => {
                if (line.startsWith('FN:')) values.fullName = line.slice(3);
                if (line.startsWith('TEL:')) values.phone = line.slice(4);
                if (line.startsWith('EMAIL:')) values.email = line.slice(6);
                if (line.startsWith('ORG:')) values.org = line.slice(4);
                if (line.startsWith('TITLE:')) values.title = line.slice(6);
                if (line.startsWith('URL:')) values.url = line.slice(4);
            });
            break;
        }
        case 'mecard': {
            const body = text.replace(/^MECARD:/i, '').replace(/;;$/, ';');
            body.split(';').forEach(segment => {
                if (!segment) return;
                if (segment.startsWith('N:')) {
                    const [lastName = '', firstName = ''] = segment.slice(2).split(',');
                    values.lastName = lastName;
                    values.firstName = firstName;
                }
                if (segment.startsWith('TEL:')) values.phone = segment.slice(4);
                if (segment.startsWith('EMAIL:')) values.email = segment.slice(6);
                if (segment.startsWith('URL:')) values.url = segment.slice(4);
            });
            break;
        }
        case 'event': {
            let eventUrl = '';
            text.split(/\r?\n/).forEach(line => {
                if (line.startsWith('SUMMARY:')) values.summary = line.slice(8);
                if (line.startsWith('DTSTART:')) values.start = parseIcsToLocalDate(line.slice(8));
                if (line.startsWith('DTEND:')) values.end = parseIcsToLocalDate(line.slice(6));
                if (line.startsWith('LOCATION:')) values.location = line.slice(9);
                if (line.startsWith('DESCRIPTION:')) values.description = line.slice(12);
                if (line.startsWith('URL:')) eventUrl = line.slice(4);
            });
            if (eventUrl) {
                try {
                    const url = new URL(eventUrl);
                    values.locationPlaceId = url.searchParams.get('query_place_id') || '';
                } catch (_error) {
                    values.locationPlaceId = '';
                }
            }
            break;
        }
        case 'merchant-future-event': {
            let eventUrl = '';
            text.split(/\r?\n/).forEach(line => {
                if (line.startsWith('SUMMARY:')) values.summary = line.slice(8);
                if (line.startsWith('DTSTART:')) {
                    const parsed = parseIcsToLocalDate(line.slice(8));
                    values.futureDate = parsed ? parsed.slice(0, 10) : '';
                }
                if (line.startsWith('LOCATION:')) values.location = line.slice(9);
                if (line.startsWith('DESCRIPTION:')) values.description = line.slice(12);
                if (line.startsWith('URL:')) eventUrl = line.slice(4);
            });
            if (eventUrl) {
                try {
                    const url = new URL(eventUrl);
                    values.locationPlaceId = url.searchParams.get('query_place_id') || '';
                } catch (_error) {
                    values.locationPlaceId = '';
                }
            }
            break;
        }
        case 'geo': {
            const body = text.replace(/^geo:/i, '');
            const [lat = '', lng = '', alt = ''] = body.split(',');
            values.lat = lat;
            values.lng = lng;
            values.alt = alt;
            break;
        }
        default:
            break;
    }

    return values;
}

function getTemplateDefaults(template) {
    const schema = TEMPLATE_FORM_SCHEMAS[template];
    if (!schema) return {};
    const defaults = {};
    schema.fields.forEach(field => {
        defaults[field.name] = field.default;
    });

    if (template === 'merchant-future-event') {
        if (!merchantScheduleSettings) {
            merchantScheduleSettings = loadMerchantScheduleSettings();
        }

        const draft = loadMerchantEventDraft();

        defaults.futureDate = defaults.futureDate || merchantScheduleSettings.scheduledDate;
        defaults.summary = draft.summary || defaults.summary;
        defaults.location = draft.location || defaults.location;
        defaults.locationPlaceId = draft.locationPlaceId || defaults.locationPlaceId;
        defaults.description = draft.description || defaults.description;
    }

    return defaults;
}

function canSeedTemplateFromPayload(template, payload) {
    const text = (payload || '').trim();
    if (!text) return false;

    switch (template) {
        case 'google-review':
            return /^https:\/\/search\.google\.com\/local\/writereview\?placeid=/i.test(text);
        case 'url':
            return /^https?:\/\//i.test(text);
        case 'email':
            return /^mailto:/i.test(text);
        case 'phone':
            return /^tel:/i.test(text);
        case 'sms':
            return /^sms:/i.test(text);
        case 'wifi':
            return /^WIFI:/i.test(text);
        case 'vcard':
            return /^BEGIN:VCARD/i.test(text);
        case 'mecard':
            return /^MECARD:/i.test(text);
        case 'event':
            return /^BEGIN:VEVENT/i.test(text);
        case 'merchant-future-event':
            return /^BEGIN:VEVENT/i.test(text);
        case 'geo':
            return /^geo:/i.test(text);
        default:
            return false;
    }
}

function renderTemplateField(field, template) {
    const name = `tpl-${field.name}`;
    const requiredAttr = field.required ? 'required' : '';
    const stepAttr = field.step ? `step="${field.step}"` : '';
    const placeholderAttr = field.placeholder ? `placeholder="${field.placeholder}"` : '';

    if (field.type === 'hidden') {
        return `<input type="hidden" id="${name}" name="${name}" value="${field.default || ''}">`;
    }

    if (field.type === 'checkbox') {
        return `
            <div class="template-form-row template-checkbox-row" data-field-row="${field.name}">
                <input type="checkbox" id="${name}" name="${name}" ${field.default ? 'checked' : ''}>
                <label for="${name}">${field.label}</label>
            </div>
        `;
    }

    if (field.type === 'select') {
        const options = (field.options || []).map(option => {
            const selected = option.value === field.default ? 'selected' : '';
            return `<option value="${option.value}" ${selected}>${option.label}</option>`;
        }).join('');

        return `
            <div class="template-form-row" data-field-row="${field.name}">
                <label for="${name}">${field.label}</label>
                <select id="${name}" name="${name}" ${requiredAttr}>${options}</select>
            </div>
        `;
    }

    if (field.type === 'textarea') {
        return `
            <div class="template-form-row" data-field-row="${field.name}">
                <label for="${name}">${field.label}</label>
                <textarea id="${name}" name="${name}" ${requiredAttr} ${placeholderAttr}>${field.default || ''}</textarea>
            </div>
        `;
    }

    if (template === 'merchant-future-event' && field.name === 'futureDate') {
        return `
            <div class="template-form-row" data-field-row="${field.name}">
                <label for="${name}">${field.label}</label>
                <div class="template-future-date-control-row">
                    <input class="merchant-future-date-input" type="${field.type}" id="${name}" name="${name}" value="${field.default || ''}" ${requiredAttr} ${stepAttr} ${placeholderAttr}>
                    <span id="templateFutureDateResolved" class="merchant-template-resolved-day-inline">Resolved Day: --</span>
                </div>
            </div>
        `;
    }

    if (field.type === 'tel-country') {
        const datalistOptions = COUNTRY_DIAL_CODES
            .map(c => `<option value="${c.dial}">${c.dial} ${c.name}</option>`).join('');
        return `
            <div class="template-form-row" data-field-row="${field.name}">
                <label>${field.label}</label>
                <div class="tel-country-row">
                    <input type="text" name="tpl-${field.name}-country"
                           class="tel-country-input" list="tel-country-datalist"
                           placeholder="+1" autocomplete="off" spellcheck="false"
                           aria-label="Country dial code">
                    <input type="tel" name="tpl-${field.name}-local"
                           class="tel-local-input"
                           placeholder="Local number (no leading 0)"
                           autocomplete="tel-local" ${requiredAttr}
                           aria-label="Local phone number">
                </div>
                <span class="template-field-hint">Country auto-detected from your browser &mdash; type to override or search, then press Down Arrow for full list</span>
                <datalist id="tel-country-datalist">${datalistOptions}</datalist>
            </div>
        `;
    }

    const hintHtml = field.hint ? `<span class="template-field-hint">${field.hint}</span>` : '';
    return `
        <div class="template-form-row" data-field-row="${field.name}">
            <label for="${name}">${field.label}</label>
            <input type="${field.type}" id="${name}" name="${name}" value="${field.default || ''}" ${requiredAttr} ${stepAttr} ${placeholderAttr}>
            ${hintHtml}
        </div>
    `;
}

function renderMerchantHoursRows() {
    if (!merchantHoursRows) return;

    const settings = merchantScheduleSettings || createDefaultMerchantSchedule();
    merchantHoursRows.innerHTML = BUSINESS_DAYS.map(day => {
        const dayHours = settings.businessHours[day];
        const closedClass = dayHours.closed ? 'is-closed' : '';
        return `
            <div class="merchant-hours-row ${closedClass}" data-day="${day}">
                <span class="merchant-hours-day">${BUSINESS_DAY_LABELS[day]}</span>
                <div class="merchant-hours-inputs">
                    <input type="time" id="merchant-${day}-open" value="${dayHours.open}">
                    <input type="time" id="merchant-${day}-close" value="${dayHours.close}">
                </div>
                <div class="merchant-hours-closed">
                    <input type="checkbox" id="merchant-${day}-closed" ${dayHours.closed ? 'checked' : ''}>
                    <label for="merchant-${day}-closed">Closed</label>
                </div>
            </div>
        `;
    }).join('');
}

function updateMerchantHoursClosedState(day) {
    const row = merchantHoursRows ? merchantHoursRows.querySelector(`[data-day="${day}"]`) : null;
    const closedEl = document.getElementById(`merchant-${day}-closed`);
    if (!row || !closedEl) return;
    row.classList.toggle('is-closed', closedEl.checked);
}

function setMerchantScheduleStatus(message) {
    if (merchantScheduleStatus) {
        merchantScheduleStatus.textContent = message;
    }
}

function formatDateWithWeekday(dateValue) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateValue || ''))) return '';
    const parsed = new Date(`${dateValue}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return '';
    const weekday = parsed.toLocaleDateString(undefined, { weekday: 'long' });
    return `${dateValue} (${weekday})`;
}

function updateFutureDateWeekdayHint(dateValue) {
    if (!futureEventDateWeekday) return;
    const label = formatDateWithWeekday(dateValue);
    futureEventDateWeekday.textContent = label
        ? `Resolved Day: ${label}`
        : 'Resolved Day: --';
}

function updateTemplateFutureResolvedDayHint(dateValue) {
    if (!templateFormFields) return;
    const hintEl = templateFormFields.querySelector('#templateFutureDateResolved');
    if (!hintEl) return;
    const label = formatDateWithWeekday(dateValue);
    hintEl.textContent = label
        ? `Resolved Day: ${label}`
        : 'Resolved Day: --';
}

function hydrateMerchantScheduleUiFromState() {
    if (!merchantScheduleSettings) {
        merchantScheduleSettings = createDefaultMerchantSchedule();
    }

    renderMerchantHoursRows();

    BUSINESS_DAYS.forEach(day => {
        updateMerchantHoursClosedState(day);
    });

    if (merchantHolidays) {
        merchantHolidays.value = (merchantScheduleSettings.holidays || []).join('\n');
    }

    if (futureEventDate) {
        futureEventDate.value = merchantScheduleSettings.scheduledDate || '';
    }
    updateFutureDateWeekdayHint(merchantScheduleSettings.scheduledDate || '');

    syncFutureOffsetDropdowns();
}

function getFutureOffsetFromUi() {
    return normalizeFutureOffset({
        days: futureQuickDays ? futureQuickDays.value : MERCHANT_FUTURE_OFFSET_DEFAULT.days,
        months: futureQuickMonths ? futureQuickMonths.value : MERCHANT_FUTURE_OFFSET_DEFAULT.months,
        years: futureQuickYears ? futureQuickYears.value : MERCHANT_FUTURE_OFFSET_DEFAULT.years
    });
}

function syncFutureOffsetDropdowns() {
    if (!merchantScheduleSettings) return;
    const offset = normalizeFutureOffset(merchantScheduleSettings.futureOffset);
    if (futureQuickDays) futureQuickDays.value = String(offset.days);
    if (futureQuickMonths) futureQuickMonths.value = String(offset.months);
    if (futureQuickYears) futureQuickYears.value = String(offset.years);
}

function applyOffsetSelectionToScheduledDate(shouldPersist = true) {
    if (!merchantScheduleSettings) {
        merchantScheduleSettings = loadMerchantScheduleSettings();
    }

    const offset = getFutureOffsetFromUi();
    const computedDate = addOffsetToDate(new Date(), offset);
    const computedDateValue = toLocalDateValue(computedDate);
    const slot = resolveBusinessDateSlot(computedDateValue, merchantScheduleSettings);
    if (!slot) {
        setMerchantScheduleStatus('Unable to find a valid business day from your selected offsets.');
        return;
    }

    if (futureEventDate) {
        futureEventDate.value = slot.resolvedDate;
    }
    updateFutureDateWeekdayHint(slot.resolvedDate);

    merchantScheduleSettings.futureOffset = offset;
    merchantScheduleSettings.scheduledDate = slot.resolvedDate;
    merchantScheduleSettings.scheduledStart = slot.start;
    merchantScheduleSettings.scheduledEnd = slot.end;

    syncFutureOffsetDropdowns();
    if (shouldPersist) {
        persistMerchantScheduleSettings();
        const shiftedCopy = slot.shiftedDays > 0
            ? ` Rolled forward ${slot.shiftedDays} day${slot.shiftedDays === 1 ? '' : 's'} to next open business day.`
            : '';
        const resolvedLabel = formatDateWithWeekday(slot.resolvedDate);
        setMerchantScheduleStatus(`Future date updated to ${resolvedLabel} from day/month/year selection.${shiftedCopy}`);
    }
}

function readMerchantScheduleFromUi() {
    const next = createDefaultMerchantSchedule();

    BUSINESS_DAYS.forEach(day => {
        const openEl = document.getElementById(`merchant-${day}-open`);
        const closeEl = document.getElementById(`merchant-${day}-close`);
        const closedEl = document.getElementById(`merchant-${day}-closed`);
        next.businessHours[day] = {
            open: normalizeTimeValue(openEl ? openEl.value : '09:00', '09:00'),
            close: normalizeTimeValue(closeEl ? closeEl.value : '17:00', '17:00'),
            closed: !!(closedEl && closedEl.checked)
        };
    });

    next.holidays = normalizeHolidayList(merchantHolidays ? merchantHolidays.value : []);
    next.futureOffset = getFutureOffsetFromUi();
    const preferredDate = futureEventDate && futureEventDate.value ? futureEventDate.value : next.scheduledDate;
    const slot = resolveBusinessDateSlot(preferredDate, {
        businessHours: next.businessHours,
        holidays: next.holidays
    });
    if (slot) {
        next.scheduledDate = slot.resolvedDate;
        next.scheduledStart = slot.start;
        next.scheduledEnd = slot.end;
    }
    return normalizeMerchantSchedule(next);
}

function saveMerchantScheduleFromUi(showToast = false) {
    merchantScheduleSettings = readMerchantScheduleFromUi();
    persistMerchantScheduleSettings();
    hydrateMerchantScheduleUiFromState();

    const message = `Saved schedule settings (${merchantScheduleSettings.holidays.length} holiday closure${merchantScheduleSettings.holidays.length === 1 ? '' : 's'}).`;
    const resolvedLabel = formatDateWithWeekday(merchantScheduleSettings.scheduledDate);
    setMerchantScheduleStatus(`${message} Next valid business day: ${resolvedLabel}.`);
    if (showToast) {
        showNotification('Merchant schedule saved.');
    }
}

function applyFutureSlotToActiveEvent() {
    saveMerchantScheduleFromUi(false);
    applyOffsetSelectionToScheduledDate(true);

    if (activeTemplateType !== 'merchant-future-event') {
        activateTemplateMode('merchant-future-event');
    }

    if (!templateFormFields) return;

    const dateEl = templateFormFields.querySelector('[name="tpl-futureDate"]');
    if (dateEl) dateEl.value = merchantScheduleSettings.scheduledDate;
    syncPayloadFromTemplateForm();
    showNotification('Applied saved future slot to Merchant Future Event template.');
}

function gatherEventValuesForCalendarInvite() {
    if (activeTemplateType === 'merchant-future-event') {
        const formValues = readTemplateFormValues('merchant-future-event');
        const slot = resolveBusinessDateSlot(formValues.futureDate, merchantScheduleSettings || loadMerchantScheduleSettings());
        if (!slot) return null;
        return {
            summary: formValues.summary,
            start: slot.start,
            end: slot.end,
            location: formValues.location,
            description: formValues.description,
            locationPlaceId: formValues.locationPlaceId,
            futureDate: slot.resolvedDate
        };
    }

    saveMerchantScheduleFromUi(false);
    return {
        summary: trimMultilineValue(labelInput.value || 'Scheduled Merchant Event'),
        start: merchantScheduleSettings.scheduledStart,
        end: merchantScheduleSettings.scheduledEnd,
        location: '',
        description: trimMultilineValue(qrNotesInput ? qrNotesInput.value : '')
    };
}

function downloadCalendarInviteFromCurrentSchedule() {
    const values = gatherEventValuesForCalendarInvite();
    if (!values) {
        alert('Unable to generate invite because no valid open business day could be found.');
        return;
    }
    const check = validateEventTimingForMerchant(values);
    if (!check.valid) {
        alert(`Cannot generate calendar invite.\n\n${check.message}`);
        return;
    }

    downloadCalendarInvite(values);
    setMerchantScheduleStatus('Calendar invite downloaded successfully.');
    showNotification('Calendar invite (.ics) downloaded.');
}

function initializeMerchantSchedulePanel() {
    if (!merchantHoursRows) return;

    merchantScheduleSettings = loadMerchantScheduleSettings();
    hydrateMerchantScheduleUiFromState();
    setMerchantScheduleStatus('Schedule settings are stored in this browser.');

    BUSINESS_DAYS.forEach(day => {
        const openEl = document.getElementById(`merchant-${day}-open`);
        const closeEl = document.getElementById(`merchant-${day}-close`);
        const closedEl = document.getElementById(`merchant-${day}-closed`);

        if (openEl) openEl.addEventListener('change', () => saveMerchantScheduleFromUi(false));
        if (closeEl) closeEl.addEventListener('change', () => saveMerchantScheduleFromUi(false));
        if (closedEl) {
            closedEl.addEventListener('change', () => {
                updateMerchantHoursClosedState(day);
                saveMerchantScheduleFromUi(false);
            });
        }
    });

    if (merchantHolidays) {
        merchantHolidays.addEventListener('change', () => saveMerchantScheduleFromUi(false));
    }
    if (futureEventDate) {
        futureEventDate.addEventListener('change', () => {
            updateFutureDateWeekdayHint(futureEventDate.value || '');
            saveMerchantScheduleFromUi(false);
        });
    }
    if (futureQuickDays) futureQuickDays.addEventListener('change', () => applyOffsetSelectionToScheduledDate(true));
    if (futureQuickMonths) futureQuickMonths.addEventListener('change', () => applyOffsetSelectionToScheduledDate(true));
    if (futureQuickYears) futureQuickYears.addEventListener('change', () => applyOffsetSelectionToScheduledDate(true));

    if (saveMerchantScheduleBtn) {
        saveMerchantScheduleBtn.addEventListener('click', () => saveMerchantScheduleFromUi(true));
    }
    if (applyFutureSlotBtn) {
        applyFutureSlotBtn.addEventListener('click', applyFutureSlotToActiveEvent);
    }
    if (downloadInviteBtn) {
        downloadInviteBtn.addEventListener('click', downloadCalendarInviteFromCurrentSchedule);
    }
}

function updateWifiPasswordFieldVisibility() {
    if (activeTemplateType !== 'wifi' || !templateFormFields) return;
    const securityEl = templateFormFields.querySelector('[name="tpl-security"]');
    const passwordRow = templateFormFields.querySelector('[data-field-row="password"]');
    if (!securityEl || !passwordRow) return;
    passwordRow.style.display = securityEl.value === 'nopass' ? 'none' : 'grid';
}

function syncPayloadFromTemplateForm() {
    if (!activeTemplateType) return;
    const values = readTemplateFormValues(activeTemplateType);

    if (activeTemplateType === 'merchant-future-event') {
        if (!merchantScheduleSettings) {
            merchantScheduleSettings = loadMerchantScheduleSettings();
        }
        const slot = resolveBusinessDateSlot(values.futureDate, merchantScheduleSettings);
        if (slot) {
            merchantScheduleSettings.scheduledDate = slot.resolvedDate;
            merchantScheduleSettings.scheduledStart = slot.start;
            merchantScheduleSettings.scheduledEnd = slot.end;
            const dateField = templateFormFields ? templateFormFields.querySelector('[name="tpl-futureDate"]') : null;
            if (dateField) dateField.value = slot.resolvedDate;
        }
        updateTemplateFutureResolvedDayHint(slot ? slot.resolvedDate : values.futureDate);
        persistMerchantScheduleSettings();
        persistMerchantEventDraft({
            summary: values.summary,
            location: values.location,
            locationPlaceId: values.locationPlaceId,
            description: values.description,
            futureDate: slot ? slot.resolvedDate : values.futureDate
        });
        if (futureEventDate) futureEventDate.value = merchantScheduleSettings.scheduledDate;
        syncFutureOffsetDropdowns();
    }

    const payload = buildPayloadFromTemplate(activeTemplateType, values);
    textInput.value = payload;
    updateTemplatePreview(payload);
    updateWifiPasswordFieldVisibility();
}

function renderTemplateForm(template, payloadSeed = '') {
    const schema = TEMPLATE_FORM_SCHEMAS[template];
    if (!schema || !templateFormFields || !templateFormTitle) return;

    templateFormTitle.textContent = schema.title;
    templateFormFields.innerHTML = schema.fields.map(field => renderTemplateField(field, template)).join('');

    const values = {
        ...getTemplateDefaults(template),
        ...parseTemplatePayload(template, payloadSeed)
    };

    schema.fields.forEach(field => {
        if (field.type === 'tel-country') {
            const dialEl = templateFormFields.querySelector(`[name="tpl-${field.name}-country"]`);
            const localEl = templateFormFields.querySelector(`[name="tpl-${field.name}-local"]`);
            const { dial, local } = splitPhoneNumber(values[field.name] || '');
            if (dialEl) dialEl.value = dial;
            if (localEl) localEl.value = local;
            return;
        }
        const fieldEl = templateFormFields.querySelector(`[name="tpl-${field.name}"]`);
        if (!fieldEl || values[field.name] === undefined || values[field.name] === null) return;
        if (field.type === 'checkbox') {
            fieldEl.checked = !!values[field.name];
        } else {
            fieldEl.value = values[field.name];
        }
    });

    syncPayloadFromTemplateForm();

    if (template === 'event' || template === 'merchant-future-event') {
        attachEventLocationSearchPanel();
    }

    const firstInteractive = templateFormFields.querySelector('input:not([type="checkbox"]), select, textarea');
    if (firstInteractive) firstInteractive.focus();
}

function attachEventLocationSearchPanel() {
    if (!templateFormFields) return;

    const existing = templateFormFields.querySelector('.event-location-search-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.className = 'event-location-search-panel';
    panel.style.marginTop = '6px';
    panel.style.padding = '10px';
    panel.style.border = '1px solid #dbe3f0';
    panel.style.borderRadius = '8px';
    panel.style.background = '#f8fbff';

    panel.innerHTML = `
        <label style="margin-bottom: 8px; font-size: 12px; color: #4f5e73;">Optional: search and insert event location from Google Maps</label>
        <div style="display: flex; gap: 8px;">
            <input type="text" class="event-location-search-input" placeholder="e.g. Seattle Convention Center" style="flex: 1;">
            <button type="button" class="btn btn-secondary event-location-search-btn">Search</button>
        </div>
        <p class="event-location-search-status" style="margin-top: 8px; font-size: 12px; color: #5f6368;"></p>
        <label style="display:flex; align-items:center; gap:6px; margin: 2px 0 8px; font-size: 12px; color: #5f6368;">
            <input type="checkbox" class="event-location-debug-toggle">
            Show lookup debug details
        </label>
        <div class="event-location-search-results" style="display: grid; gap: 6px;"></div>
    `;

    templateFormFields.appendChild(panel);

    const searchInput = panel.querySelector('.event-location-search-input');
    const searchBtn = panel.querySelector('.event-location-search-btn');
    const searchStatus = panel.querySelector('.event-location-search-status');
    const debugToggle = panel.querySelector('.event-location-debug-toggle');
    const searchResults = panel.querySelector('.event-location-search-results');
    const locationInput = templateFormFields.querySelector('[name="tpl-location"]');
    const placeIdInput = templateFormFields.querySelector('[name="tpl-locationPlaceId"]');
    let selectedLocationText = locationInput ? locationInput.value.trim() : '';

    const setLocationLookupStatus = (message, color = '#666', debugDetails = '') => {
        const showDebug = !!(debugToggle && debugToggle.checked);
        const withDebug = showDebug && debugDetails ? `${message} (${debugDetails})` : message;
        searchStatus.textContent = withDebug;
        searchStatus.style.color = color;
    };

    if (debugToggle) {
        debugToggle.checked = loadEventLocationDebugPreference();
        debugToggle.addEventListener('change', () => {
            persistEventLocationDebugPreference(debugToggle.checked);
        });
    }

    if (placeIdInput && placeIdInput.value) {
        setLocationLookupStatus('Restored saved location with Google Maps link.', '#4CAF50', `placeId=${placeIdInput.value}`);
        if (searchInput && selectedLocationText) {
            searchInput.value = selectedLocationText;
        }

        // On restore, backfill phone details into description when missing.
        if (!hasPhoneDataInDescriptionField()) {
            fetchPlacePhoneNumber(placeIdInput.value).then(phoneLookup => {
                if (phoneLookup.status !== 'found') return;
                const inserted = addPlacePhoneToDescriptionField(phoneLookup.phone);
                if (inserted) {
                    setLocationLookupStatus('Restored saved location and repopulated phone details in description.', '#4CAF50', `phone=${phoneLookup.phone}`);
                }
            }).catch(() => {
                // Keep UI stable if phone lookup fails during restore.
            });
        }
    }

    if (locationInput && placeIdInput) {
        locationInput.addEventListener('input', () => {
            if (locationInput.value.trim() !== selectedLocationText && placeIdInput.value) {
                placeIdInput.value = '';
                searchStatus.textContent = 'Location text edited manually. Maps place link cleared (search again to reattach).';
                searchStatus.style.color = '#666';
                syncPayloadFromTemplateForm();
            }
        });
    }

    const runSearch = async () => {
        const query = searchInput.value.trim();
        searchResults.innerHTML = '';

        if (!query) {
            setLocationLookupStatus('Enter a place or address to search.', '#666', 'empty-query');
            return;
        }

        if (!GOOGLE_MAPS_API_KEY) {
            setLocationLookupStatus('No Maps API key set. Add GOOGLE_MAPS_API_KEY in app.js to enable location search.', '#f57c00', 'missing-api-key');
            return;
        }

        setLocationLookupStatus('Searching...', '#1565C0', `query=${query}`);

        try {
            await loadGoogleMapsAPI();

            const { suggestions } = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
                input: query
            });

            if (!suggestions || suggestions.length === 0) {
                setLocationLookupStatus('No locations found. Try a more specific query.', '#666', `query=${query}`);
                return;
            }

            setLocationLookupStatus(`${Math.min(suggestions.length, 6)} result(s). Click one to set Event Location.`, '#4CAF50', `query=${query}`);

            suggestions.slice(0, 6).forEach(suggestion => {
                const pred = suggestion.placePrediction;
                const placeId = pred.placeId;
                const name = pred.mainText ? pred.mainText.toString() : pred.text.toString();
                const address = pred.secondaryText ? pred.secondaryText.toString() : '';
                const chosenText = address ? `${name}, ${address}` : name;

                const card = document.createElement('button');
                card.type = 'button';
                card.className = 'event-location-result-card';
                card.style.textAlign = 'left';
                card.style.border = '1px solid #d2dae8';
                card.style.borderRadius = '8px';
                card.style.padding = '8px 10px';
                card.style.background = '#fff';
                card.style.cursor = 'pointer';
                card.innerHTML = `<strong style="display:block; color:#2f3b4a;">${name}</strong><span style="font-size:12px; color:#5f6368;">${address}</span>`;

                card.addEventListener('click', async () => {
                    if (locationInput) {
                        locationInput.value = chosenText;
                    }
                    if (placeIdInput) {
                        placeIdInput.value = placeId || '';
                    }
                    selectedLocationText = chosenText;
                    syncPayloadFromTemplateForm();
                    setLocationLookupStatus(`Location set with Maps link: ${chosenText}`, '#4CAF50', `placeId=${placeId}`);
                    Array.from(searchResults.querySelectorAll('.event-location-result-card')).forEach(el => {
                        el.style.borderColor = '#d2dae8';
                        el.style.background = '#fff';
                    });
                    card.style.borderColor = '#4CAF50';
                    card.style.background = '#f0faf2';

                    const phoneLookup = await fetchPlacePhoneNumber(placeId);
                    if (phoneLookup.status === 'found') {
                        const inserted = addPlacePhoneToDescriptionField(phoneLookup.phone);
                        setLocationLookupStatus(
                            inserted
                                ? `Location set with Maps link: ${chosenText}. Phone found and added to description.`
                                : `Location set with Maps link: ${chosenText}. Phone found (already in description).`,
                            '#4CAF50',
                            `status=found; phone=${phoneLookup.phone}`
                        );
                    } else if (phoneLookup.status === 'not-published') {
                        setLocationLookupStatus(`Location set with Maps link: ${chosenText}. No phone published for this place.`, '#666', 'status=not-published');
                    } else if (phoneLookup.status === 'api-blocked') {
                        setLocationLookupStatus(`Location set with Maps link: ${chosenText}. Phone lookup blocked by API key restrictions.`, '#f57c00', 'status=api-blocked');
                    } else {
                        setLocationLookupStatus(`Location set with Maps link: ${chosenText}. Phone lookup was unavailable.`, '#666', 'status=lookup-failed');
                    }
                });

                searchResults.appendChild(card);
            });
        } catch (error) {
            setLocationLookupStatus(`Search failed: ${error.message}`, '#f44336', 'search-failed');
            console.error('Event location search error:', error);
        }
    };

    searchBtn.addEventListener('click', runSearch);
    searchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            runSearch();
        }
    });
}

function setTemplateUiState(template) {
    if (placeIdPanel) placeIdPanel.style.display = template === 'google-review' ? 'block' : 'none';
    if (wifiPrivacyNotice) wifiPrivacyNotice.style.display = template === 'wifi' ? 'block' : 'none';
    if (merchantSchedulePanel) merchantSchedulePanel.style.display = template === 'merchant-future-event' ? 'block' : 'none';

    isGoogleReviewMode = template === 'google-review';
    if (googleColorToggle) {
        googleColorToggle.style.display = isGoogleReviewMode ? 'block' : 'none';
    }

    if (template === 'google-review' && placeIdPanel) {
        const hint = document.getElementById('placeApiKeyHint');
        if (hint) hint.style.display = GOOGLE_MAPS_API_KEY ? 'none' : 'block';
    }
}

function activateTemplateMode(template, payloadSeed = '') {
    if (!TEMPLATE_FORM_SCHEMAS[template]) return;

    activeTemplateType = template;
    templateBtns.forEach(templateBtn => {
        templateBtn.classList.toggle('active-filter', templateBtn.dataset.template === template);
    });
    filterUseCases();

    if (rawInputContainer) rawInputContainer.style.display = 'none';
    if (templateFormContainer) templateFormContainer.style.display = 'block';
    if (templateFormBody) templateFormBody.style.display = 'block';
    if (manualInputBtn) manualInputBtn.textContent = 'Switch to Manual Input';

    setTemplateUiState(template);
    // Use provided seed, or fall back to cached data for this template
    const seed = payloadSeed || templateDataCache[template] || '';
    renderTemplateForm(template, seed);

    if (!payloadSeed && template === 'google-review') {
        labelInput.value = 'Leave us a Google Review!';
    }

    if (typeof gtag !== 'undefined') {
        gtag('event', 'input_template_selected', { template });
    }
}

function deactivateTemplateMode({ focusTextInput = false, clearTemplateFilter = true, showBackBtn = false } = {}) {
    // Save the current template's payload to cache before deactivating
    if (activeTemplateType && textInput) {
        const payload = textInput.value;
        if (payload && payload.trim()) {
            templateDataCache[activeTemplateType] = payload;
        }
        if (showBackBtn) {
            lastActiveTemplate = activeTemplateType;
        }
    }
    activeTemplateType = null;
    if (rawInputContainer) rawInputContainer.style.display = 'block';

    if (showBackBtn && lastActiveTemplate) {
        // Keep the header visible with the toggle button; collapse only the form body
        if (templateFormBody) templateFormBody.style.display = 'none';
        if (manualInputBtn) manualInputBtn.textContent = '\u2190 Back to Template';
        // Keep the generated template payload visible/editable in manual mode.
        const cachedPayload = templateDataCache[lastActiveTemplate];
        if (cachedPayload) textInput.value = cachedPayload;
    } else {
        // Full deactivation — hide the entire container
        if (templateFormFields) templateFormFields.innerHTML = '';
        updateTemplatePreview('');
        if (templateFormContainer) templateFormContainer.style.display = 'none';
        lastActiveTemplate = null;
    }

    isGoogleReviewMode = false;
    if (googleColorToggle) googleColorToggle.style.display = 'none';
    if (placeIdPanel) placeIdPanel.style.display = 'none';
    if (wifiPrivacyNotice) wifiPrivacyNotice.style.display = 'none';
    if (merchantSchedulePanel) merchantSchedulePanel.style.display = 'none';

    if (clearTemplateFilter) {
        templateBtns.forEach(templateBtn => templateBtn.classList.remove('active-filter'));
        filterUseCases();
    }

    if (focusTextInput) textInput.focus();
}

if (templateFormFields) {
    templateFormFields.addEventListener('input', () => {
        syncPayloadFromTemplateForm();
    });

    templateFormFields.addEventListener('change', () => {
        syncPayloadFromTemplateForm();
    });
}

if (manualInputBtn) {
    manualInputBtn.addEventListener('click', () => {
        if (activeTemplateType) {
            // Currently in template mode — switch to manual
            deactivateTemplateMode({ focusTextInput: true, showBackBtn: true, clearTemplateFilter: false });
        } else if (lastActiveTemplate) {
            // Currently in manual mode — go back to the last template
            // Try to seed from manual text if it matches the template format
            const currentPayload = textInput.value.trim();
            const payloadSeed = canSeedTemplateFromPayload(lastActiveTemplate, currentPayload) ? currentPayload : '';
            activateTemplateMode(lastActiveTemplate, payloadSeed);
        }
    });
}

// Cropper modal elements
const cropperModal = document.getElementById('cropperModal');
const cropperImage = document.getElementById('cropperImage');
const cropperCancel = document.getElementById('cropperCancel');
const cropperApply = document.getElementById('cropperApply');
const cropperRotateLeft = document.getElementById('cropperRotateLeft');
const cropperRotateRight = document.getElementById('cropperRotateRight');
const cropperFlipH = document.getElementById('cropperFlipH');
const cropperFlipV = document.getElementById('cropperFlipV');
const cropperRedraw = document.getElementById('cropperRedraw');
const cropperReset = document.getElementById('cropperReset');

// Cropper instance and state
let cropperInstance = null;
let currentCropMode = null; // 'logo' or 'background'
let pendingImageFile = null;
let cropperIsRedrawing = false;

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

cropperRedraw.addEventListener('click', () => {
    if (cropperInstance) {
        cropperIsRedrawing = true;
        cropperInstance.clear();
        cropperInstance.setDragMode('crop');
    }
});

cropperReset.addEventListener('click', () => {
    if (cropperInstance) {
        cropperIsRedrawing = false;
        cropperInstance.reset();
        cropperInstance.setDragMode('move');
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
        if (activeTemplateType === template) {
            deactivateTemplateMode({ focusTextInput: true });
            return;
        }

        // Save current template's data before switching to a different template
        if (activeTemplateType && textInput) {
            const payload = textInput.value;
            if (payload && payload.trim()) {
                templateDataCache[activeTemplateType] = payload;
            }
        }

        // Switching directly between templates - use cached data for the new template
        activateTemplateMode(template);
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
    {
        type: 'wifi',
        icon: '🏠',
        title: 'Home Guest WiFi',
        description: 'Friends and family at home can connect quickly without typing a long password',
        content: 'WIFI:T:WPA;S:HomeGuest;P:FamilyVisit2026;;',
        label: 'Scan for Home WiFi'
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
    {
        type: 'merchant-future-event',
        icon: '🏪',
        title: 'Merchant Future Event',
        description: 'Schedule up to a year ahead with business-hours and holiday validation',
        content: 'BEGIN:VEVENT\nSUMMARY:Holiday Preview Weekend\nDTSTART:20270610T150000Z\nDTEND:20270610T180000Z\nLOCATION:Downtown Flagship Store\nDESCRIPTION:Exclusive preview event scheduled within merchant operating hours\nEND:VEVENT',
        label: 'Save Merchant Event'
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
    const rawContent = unescapeHtml(content);
    textInput.value = rawContent;
    labelInput.value = unescapeHtml(label);

    if (TEMPLATE_FORM_SCHEMAS[type]) {
        activateTemplateMode(type, rawContent);
    } else {
        deactivateTemplateMode({ clearTemplateFilter: false });
    }

    // Flash the changed input area to signal update
    const flashTarget = activeTemplateType ? templatePreviewOutput : textInput;
    flashTarget.style.background = '#e7f3ff';
    setTimeout(() => {
        flashTarget.style.background = '';
    }, 500);

    if (activeTemplateType) {
        const firstField = templateFormFields ? templateFormFields.querySelector('input:not([type="checkbox"]), select, textarea') : null;
        if (firstField) firstField.focus();
    } else {
        textInput.focus();
    }
    
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
        syncGradientControlState();
        
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
    syncGradientControlState();
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
        syncGradientControlState();
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
});

labelColorPicker.addEventListener('change', (e) => {
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
            activeTemplate: activeTemplateType,
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
        queueHistorySaveToLocalStorage();
        
    } catch (error) {
        console.error('Error saving state:', error);
    }
}

function queueHistorySaveToLocalStorage() {
    if (historySaveTimer) {
        clearTimeout(historySaveTimer);
    }

    // Debounce to avoid synchronous localStorage writes on rapid UI changes.
    historySaveTimer = setTimeout(() => {
        saveHistoryToLocalStorage();
    }, 300);
}

// Restore a specific state from history
function restoreState(state) {
    isRestoringState = true;
    
    try {
        // Restore text input
        textInput.value = state.text;

        if (state.activeTemplate && TEMPLATE_FORM_SCHEMAS[state.activeTemplate]) {
            activateTemplateMode(state.activeTemplate, state.text || '');
        } else {
            deactivateTemplateMode({ clearTemplateFilter: false });
        }
        
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
        if (googleColorToggle) {
            googleColorToggle.style.display = isGoogleReviewMode ? 'block' : 'none';
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
    // Check if user has opted out of history saving
    if (!privacyOptInPreference) {
        return;
    }
    
    try {
        const historyData = {
            version: 1,
            timestamp: Date.now(),
            history: stateHistory,
            index: currentStateIndex
        };
        const serialized = JSON.stringify(historyData);

        // Skip very large writes; huge image snapshots can freeze the UI during setItem.
        if (serialized.length > MAX_HISTORY_STORAGE_CHARS) {
            if (!hasWarnedHistoryStorageSize) {
                showNotification('History is getting large, so disk persistence was temporarily reduced to keep editing smooth.', 'warning');
                hasWarnedHistoryStorageSize = true;
            }
            return;
        }

        localStorage.setItem('qr_history', serialized);
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
    // Check if user has opted out of history saving
    if (!privacyOptInPreference) {
        return;
    }
    
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

function isGradientEligible() {
    const dotStyle = dotStyleSelect?.value || 'rounded';
    if (dotStyle === 'square') {
        return false;
    }

    const baseRgb = hexToRgb(currentDarkColor);
    const shiftedRgb = hexToRgb(adjustColorBrightness(currentDarkColor, 20));
    if (!baseRgb || !shiftedRgb) {
        return false;
    }

    const minChannel = Math.min(baseRgb.r, baseRgb.g, baseRgb.b);
    const maxChannel = Math.max(baseRgb.r, baseRgb.g, baseRgb.b);

    // Pure black/white (or very near) makes this subtle gradient effectively invisible.
    if (maxChannel < 30 || minChannel > 225) {
        return false;
    }

    const colorDelta = Math.abs(shiftedRgb.r - baseRgb.r) + Math.abs(shiftedRgb.g - baseRgb.g) + Math.abs(shiftedRgb.b - baseRgb.b);
    return colorDelta >= 12;
}

function syncGradientControlState() {
    if (!enableGradientCheckbox) return;

    const gradientGroup = document.getElementById('gradientRotationGroup');
    const gradientHelpNote = document.getElementById('gradientHelpNote');
    const eligible = isGradientEligible();

    enableGradientCheckbox.disabled = !eligible;

    if (!eligible) {
        enableGradientCheckbox.checked = false;
        if (gradientGroup) {
            gradientGroup.style.display = 'none';
        }
        if (gradientHelpNote) {
            gradientHelpNote.textContent = 'Gradient is unavailable for square dots or near pure black/white QR colors.';
        }
        return;
    }

    if (gradientGroup) {
        gradientGroup.style.display = enableGradientCheckbox.checked ? 'block' : 'none';
    }
    if (gradientHelpNote) {
        gradientHelpNote.textContent = 'Gradient blends QR dots from your dark color to a lighter shade; corners remain solid.';
    }
}

if (dotStyleSelect) {
    dotStyleSelect.addEventListener('change', (e) => {
        syncGradientControlState();
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

syncGradientControlState();

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

    // Treat this as a quick action: open the picker immediately.
    bgImageInput.click();
});

aiBgBtn.addEventListener('click', () => {
    if (blockCreateImageFeatureAccess('source_button')) {
        return;
    }

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
    if (blockCreateImageFeatureAccess('generate_button')) {
        return;
    }

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
    if (blockCreateImageFeatureAccess('cancel_button')) {
        return;
    }

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
    if (blockCreateImageFeatureAccess('backup_button')) {
        return;
    }

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
    if (blockCreateImageFeatureAccess('ai_retry_function')) {
        return;
    }

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
                    if (attempt < maxAttempts) {
                        console.warn('⏱️ Timeout after', elapsed, 'seconds (will retry)');
                    } else {
                        console.error('⏱️ Timeout after', elapsed, 'seconds');
                    }
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
                    if (attempt < maxAttempts) {
                        console.warn(`❌ Image load failed after ${elapsed} seconds (attempt ${attempt}/${maxAttempts}, retrying)`);
                    } else {
                        console.error('❌ Image load failed after', elapsed, 'seconds');
                        console.error('❌ Error event:', error);
                        console.error('🔍 Check Network tab for details (F12 → Network)');
                        console.error('🔍 Common issues:');
                        console.error('   - Browser extension blocking (disable ad blockers)');
                        console.error('   - CORS policy error');
                        console.error('   - Firewall/antivirus blocking');
                        console.error('   - DNS/network issue');
                    }
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
        if (attempt < maxAttempts) {
            console.warn('AI image generation error (attempt ' + attempt + ' of ' + maxAttempts + ', retrying):', error.message);
        } else {
            console.error('AI image generation error (attempt ' + attempt + '):', error);
        }
        
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
    if (blockCreateImageFeatureAccess('prompt_helper_toggle')) {
        return;
    }

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
    if (blockCreateImageFeatureAccess('prompt_generate')) {
        return;
    }

    generatePromptSuggestions();
});

retryPromptBtn.addEventListener('click', () => {
    if (blockCreateImageFeatureAccess('prompt_retry')) {
        return;
    }

    generatePromptSuggestions();
});

function generatePromptSuggestions() {
    if (blockCreateImageFeatureAccess('prompt_suggestions_function')) {
        return;
    }

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

    if (!GEMINI_API_KEY) {
        promptSuggestions.innerHTML = `<div style="text-align: center; padding: 20px; color: #f44336;">
            <strong>Gemini API key missing.</strong><br>
            <span style="font-size: 0.9em; color: #666;">Add your active key to <code>GEMINI_API_KEY</code> in app.js.</span>
        </div>`;
        retryPromptBtn.style.display = 'block';
        setGeminiModelStatus('AI model: unavailable (missing API key)', '#f44336');
        return;
    }
    
    // Call Gemini API to generate image prompts
    generatePromptWithGemini(context)
        .then(suggestions => {
            displayPromptSuggestions(suggestions);
        })
        .catch(error => {
            console.error('Failed to generate prompts:', error);
            console.error('Error details:', error.message);

            if (error.message.includes('GEMINI_API_KEY_LEAKED')) {
                promptSuggestions.innerHTML = `<div style="text-align: center; padding: 20px; color: #f44336;">
                    <strong>API key blocked by Google.</strong><br>
                    <span style="font-size: 0.9em; color: #666;">This key was flagged as leaked. Create a new key and replace <code>GEMINI_API_KEY</code> in app.js.</span>
                </div>`;
                retryPromptBtn.style.display = 'block';
                setGeminiModelStatus('AI model: blocked key (rotate Gemini API key)', '#f44336');
                return;
            }
            
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
                if (activeTemplateType === 'google-review' && templateFormFields) {
                    const placeIdInput = templateFormFields.querySelector('[name="tpl-placeId"]');
                    if (placeIdInput) {
                        placeIdInput.value = placeId;
                        syncPayloadFromTemplateForm();
                    }
                }
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

function isGeminiKeyLeakedError(statusCode, errorText = '') {
    return statusCode === 403 && /reported as leaked|api key was reported as leaked/i.test(errorText);
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
    if (!GEMINI_API_KEY) return [];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GEMINI_DISCOVERY_TIMEOUT_MS);

    try {
        for (const baseUrl of GEMINI_API_BASES) {
            const response = await fetch(`${baseUrl}/models?key=${GEMINI_API_KEY}`, {
                signal: controller.signal
            });

            if (!response.ok) {
                if (response.status !== 403) {
                    console.warn(`Gemini model discovery failed on ${baseUrl} (${response.status})`);
                }
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
    if (!GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY_MISSING');
    }

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
                    if (isGeminiKeyLeakedError(response.status, errorText)) {
                        throw new Error('GEMINI_API_KEY_LEAKED');
                    }
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
    if (_logoBlobURL) {
        URL.revokeObjectURL(_logoBlobURL);
        _logoBlobURL = null;
    }
    logoInput.value = '';
    logoStatus.textContent = 'No logo selected';
    logoStatus.style.color = '#888';
    const preview = document.getElementById('logoPreview');
    if (preview) { preview.style.display = 'none'; preview.src = ''; }
    
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

function syncBucketSelectionToPreview() {
    const selectedQRs = qrBucket.filter(qr => qr.selected);
    if (selectedQRs.length !== 1) {
        return;
    }

    const qr = selectedQRs[0];
    const metadata = qr.metadata || {};
    const settings = metadata.settings || {};
    const colors = metadata.colors || {};
    const artistic = metadata.artistic || {};
    const previewToken = ++activeBucketPreviewToken;

    textInput.value = metadata.text || '';
    labelInput.value = metadata.label || '';
    if (qrNotesInput) qrNotesInput.value = metadata.notes || '';

    if (settings.size) {
        sizeRange.value = settings.size;
        sizeValue.textContent = settings.size;
    }
    if (settings.border) {
        borderRange.value = settings.border;
        borderValue.textContent = settings.border;
    }
    if (settings.logoSize) {
        logoSizeRange.value = settings.logoSize;
        logoSizeValue.textContent = `${settings.logoSize}%`;
    }
    if (settings.labelSize) {
        labelSizeRange.value = settings.labelSize;
        labelSizeValue.textContent = `${settings.labelSize}%`;
    }

    currentDarkColor = colors.dark || currentDarkColor;
    currentLightColor = colors.light || currentLightColor;
    currentLabelColor = colors.label || currentLabelColor;
    darkColorPicker.value = currentDarkColor;
    darkColorText.value = currentDarkColor;
    lightColorPicker.value = currentLightColor;
    lightColorText.value = currentLightColor;
    labelColorPicker.value = currentLabelColor;
    labelColorText.value = currentLabelColor;

    currentQRStyle = metadata.style || currentQRStyle;
    styleBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.style === currentQRStyle);
    });

    currentErrorCorrectionLevel = metadata.errorCorrection || currentErrorCorrectionLevel;
    if (errorCorrectionLevel) {
        errorCorrectionLevel.value = currentErrorCorrectionLevel;
    }

    currentBlendMode = artistic.blendMode || currentBlendMode;
    if (blendModeSelect) {
        blendModeSelect.value = currentBlendMode;
    }

    currentBgOpacity = Number.isFinite(parseInt(artistic.bgOpacity, 10)) ? parseInt(artistic.bgOpacity, 10) : currentBgOpacity;
    bgOpacityRange.value = currentBgOpacity;
    bgOpacityValue.textContent = currentBgOpacity;

    currentQrStrength = Number.isFinite(parseInt(artistic.qrStrength, 10)) ? parseInt(artistic.qrStrength, 10) : currentQrStrength;
    qrStrengthRange.value = currentQrStrength;
    qrStrengthValue.textContent = currentQrStrength;

    if (contextInput) contextInput.value = artistic.context || '';
    if (aiPromptInput) aiPromptInput.value = artistic.imagePrompt || '';
    lastAiBackgroundMeta = artistic.aiBackground || null;
    lastGeneratedSuggestions = artistic.allGeneratedSuggestions || null;

    if (qr.canvas) {
        qrCanvas.width = qr.canvas.width;
        qrCanvas.height = qr.canvas.height;
        const ctx = qrCanvas.getContext('2d');
        ctx.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
        ctx.drawImage(qr.canvas, 0, 0);
        qrCanvas.classList.add('visible');
        previewPlaceholder.classList.add('hidden');
    }

    currentQRDataURL = qr.dataURL || (qr.canvas ? qr.canvas.toDataURL('image/png') : null);
    addToBucketBtn.disabled = !currentQRDataURL;
    syncGradientControlState();

    const logoPreview = document.getElementById('logoPreview');
    if (metadata.logo?.hasLogo && metadata.logo.logoDataURL) {
        if (logoPreview) {
            logoPreview.src = metadata.logo.logoDataURL;
            logoPreview.style.display = 'block';
        }
        logoStatus.textContent = 'Logo restored from selected QR';
        logoStatus.style.color = '#4CAF50';

        const logoImg = new Image();
        logoImg.onload = () => {
            if (previewToken === activeBucketPreviewToken) {
                selectedLogo = logoImg;
            }
        };
        logoImg.src = metadata.logo.logoDataURL;
    } else {
        selectedLogo = null;
        if (logoPreview) {
            logoPreview.style.display = 'none';
            logoPreview.src = '';
        }
        logoStatus.textContent = 'No logo selected';
        logoStatus.style.color = '#666';
    }

    if (artistic.hasBackground && artistic.backgroundDataURL) {
        bgPreviewImage.src = artistic.backgroundDataURL;
        bgPreviewSection.style.display = 'block';
        blendControlsSection.style.display = 'block';
        bgImageStatus.textContent = 'Background restored from selected QR';
        bgImageStatus.style.color = '#4CAF50';

        const bgImg = new Image();
        bgImg.onload = () => {
            if (previewToken === activeBucketPreviewToken) {
                backgroundImage = bgImg;
            }
        };
        bgImg.src = artistic.backgroundDataURL;
    } else {
        backgroundImage = null;
        bgPreviewImage.src = '';
        bgPreviewSection.style.display = 'none';
        blendControlsSection.style.display = 'none';
        bgImageStatus.textContent = 'No background selected';
        bgImageStatus.style.color = '#666';
    }
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

        syncBucketSelectionToPreview();
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
function canGenerateCurrentQrPayload() {
    if (activeTemplateType !== 'merchant-future-event') return true;

    const formValues = readTemplateFormValues('merchant-future-event');
    const slot = resolveBusinessDateSlot(formValues.futureDate, merchantScheduleSettings || loadMerchantScheduleSettings());
    if (!slot) {
        alert('Cannot generate QR yet because no valid open business day could be found from the selected future date.');
        return false;
    }

    const eventValues = {
        ...formValues,
        start: slot.start,
        end: slot.end,
        futureDate: slot.resolvedDate
    };
    const validation = validateEventTimingForMerchant(eventValues);
    if (!validation.valid) {
        alert(`Cannot generate QR for this event yet.\n\n${validation.message}`);
        return false;
    }

    return true;
}

generateBtn.addEventListener('click', () => {
    if (activeTemplateType === 'merchant-future-event') {
        // Persist both schedule settings and merchant event draft before generation.
        saveMerchantScheduleFromUi(false);
        syncPayloadFromTemplateForm();
    }

    if (!canGenerateCurrentQrPayload()) {
        return;
    }
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
    deactivateTemplateMode();
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

const ROADMAP_STORAGE_KEY = 'qrRoadmapItemsV1';
const RELEASE_TIMELINE_CONFIG = {
    owner: 'fitzgr',
    repo: 'qr-code-generator',
    branch: 'artistic-brand-mode-experiment',
    dataSource: 'private',
    // Expected JSON payload: { releases: [...], commits: [...] }
    privateTimelineEndpoint: '/api/release-timeline',
    whatsNewVisibleDays: 3,
    businessHoursStart: 9,
    businessHoursEnd: 17
};

const RELEASE_NOTE_GROUP_ORDER = ['feat', 'fix', 'ui', 'perf', 'docs', 'other'];

const RELEASE_NOTE_GROUP_LABELS = {
    feat: 'Features',
    fix: 'Fixes',
    ui: 'UI/UX',
    perf: 'Performance',
    docs: 'Docs',
    other: 'Other'
};

const DEVELOPMENT_ACTIVITY_ALLOWED_WINDOWS = [
    { startHour: 9, endHour: 12 },
    { startHour: 13, endHour: 17 }
];

function hashStringToInt(input) {
    const text = String(input || '');
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) - hash) + text.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

function isInWorkHours(date) {
    const hour = date.getHours() + (date.getMinutes() / 60);
    const inMorningBlock = hour >= 9 && hour < 12;
    const inAfternoonBlock = hour >= 13 && hour < 17;
    return inMorningBlock || inAfternoonBlock;
}

function getNthWeekdayOfMonth(year, month, weekday, occurrence) {
    const first = new Date(year, month, 1);
    const firstWeekdayOffset = (7 + weekday - first.getDay()) % 7;
    return new Date(year, month, 1 + firstWeekdayOffset + ((occurrence - 1) * 7));
}

function getLastWeekdayOfMonth(year, month, weekday) {
    const last = new Date(year, month + 1, 0);
    const offset = (7 + last.getDay() - weekday) % 7;
    return new Date(year, month, last.getDate() - offset);
}

function getEasterSunday(year) {
    const century = Math.floor(year / 100);
    const yearInCentury = year % 100;
    const leapCenturyAdjust = Math.floor(century / 4);
    const centuryRemainder = century % 4;
    const moonCorrection = Math.floor((century + 8) / 25);
    const leapCorrection = Math.floor((century - moonCorrection + 1) / 3);
    const epact = (19 * (year % 19) + century - leapCenturyAdjust - leapCorrection + 15) % 30;
    const yearQuarter = Math.floor(yearInCentury / 4);
    const yearRemainder = yearInCentury % 4;
    const weekdayCorrection = (32 + 2 * centuryRemainder + 2 * yearQuarter - epact - yearRemainder) % 7;
    const monthFactor = Math.floor((year % 19 + 11 * epact + 22 * weekdayCorrection) / 451);
    const month = Math.floor((epact + weekdayCorrection - 7 * monthFactor + 114) / 31) - 1;
    const day = ((epact + weekdayCorrection - 7 * monthFactor + 114) % 31) + 1;
    return new Date(year, month, day);
}

function isSameLocalDate(date, other) {
    return date.getFullYear() === other.getFullYear()
        && date.getMonth() === other.getMonth()
        && date.getDate() === other.getDate();
}

function isCanadianHoliday(date) {
    const year = date.getFullYear();
    const holidays = [];

    holidays.push(new Date(year, 0, 1));
    holidays.push(getNthWeekdayOfMonth(year, 1, 1, 3));

    const easterSunday = getEasterSunday(year);
    const goodFriday = new Date(easterSunday);
    goodFriday.setDate(easterSunday.getDate() - 2);
    holidays.push(goodFriday);

    holidays.push(getLastWeekdayOfMonth(year, 4, 1));
    holidays.push(new Date(year, 6, 1));
    holidays.push(getNthWeekdayOfMonth(year, 8, 1, 1));
    holidays.push(new Date(year, 8, 30));
    holidays.push(getNthWeekdayOfMonth(year, 9, 1, 2));
    holidays.push(new Date(year, 10, 11));
    holidays.push(new Date(year, 11, 25));
    holidays.push(new Date(year, 11, 26));

    return holidays.some(holiday => isSameLocalDate(date, holiday));
}

function shouldPreserveDevelopmentActivityTime(date) {
    const day = date.getDay();
    const isWeekend = day === 0 || day === 6;
    return isWeekend || isCanadianHoliday(date);
}

function remapCommitTimeToAllowedWindow(dateValue, seed) {
    const original = new Date(dateValue);
    if (Number.isNaN(original.getTime()) || shouldPreserveDevelopmentActivityTime(original) || isInWorkHours(original)) {
        return original;
    }

    const seedA = hashStringToInt(`${seed}|slot`);
    const seedB = hashStringToInt(`${seed}|minute`);
    const slot = DEVELOPMENT_ACTIVITY_ALLOWED_WINDOWS[seedA % DEVELOPMENT_ACTIVITY_ALLOWED_WINDOWS.length];
    const availableMinutes = (slot.endHour - slot.startHour) * 60;
    const minuteOffset = seedB % Math.max(availableMinutes, 1);

    const remapped = new Date(original);
    remapped.setHours(slot.startHour, 0, 0, 0);
    remapped.setMinutes(minuteOffset);
    return remapped;
}

function sanitizeDevelopmentActivityTimes(activity) {
    return (Array.isArray(activity) ? activity : []).map(entry => {
        const seed = `${entry?.message || ''}|${entry?.author || ''}|${entry?.committedAt || ''}`;
        const remapped = remapCommitTimeToAllowedWindow(entry?.committedAt, seed);
        return {
            ...entry,
            committedAt: Number.isNaN(remapped.getTime()) ? entry?.committedAt : remapped.toISOString()
        };
    });
}

const FALLBACK_RELEASE_HISTORY = [
    {
        version: 'v2.5.0',
        releasedAt: '2026-06-28T19:30:00Z',
        notes: [
            'Added persistent Merchant Future Event draft data, including event title, description, and saved location/place linking.',
            'Added Google Places phone lookup outcomes with clear status messaging and optional debug details in location search.',
            'Added resolved business-day visibility improvements, including weekday display and compact Future Date row alignment.'
        ]
    },
    {
        version: 'v2.4.0',
        releasedAt: '2026-06-28T16:30:00Z',
        notes: [
            'Added Merchant Future Event template so schedule-aware merchant events are isolated from standard Event QR creation.',
            'Added merchant schedule visibility rules so business-hours controls only appear when Merchant Future Event is selected.',
            'Added persisted future scheduling defaults, hours/holiday validation, and calendar invite export wiring for merchant event workflows.'
        ]
    },
    {
        version: 'v2.3.0',
        releasedAt: '2026-03-21T16:00:00Z',
        notes: [
            'Expanded country dial code list from 50 to 190+ countries with comprehensive ISO 3166-1 support.',
            'Added a privacy banner with local storage disclosure, opt-in history persistence, and a settings shortcut to reopen privacy details.',
            'Fixed template data isolation so event, phone, and other template payloads stay separated when switching modes.'
        ]
    },
    {
        version: 'v2.2.0',
        releasedAt: '2026-03-19T22:30:00Z',
        notes: [
            'Launched structured template forms so users can safely enter metadata without breaking payload formats.',
            'Added read-only generated template previews under each template form for better visibility and trust.',
            'Added Google Maps location search inside Event template and improved Email defaults/seeding behavior.'
        ]
    },
    {
        version: 'v2.1.2',
        releasedAt: '2026-03-19T21:00:00Z',
        notes: [
            'Added a Home Guest WiFi use case example to make household guest onboarding faster.',
            'Expanded roadmap planning with an Instagram-linked feedback loop item.',
            'Updated release timeline metadata for the new patch release.'
        ]
    },
    {
        version: 'v2.1.1',
        releasedAt: '2026-03-16T23:30:00Z',
        notes: [
            'Fixed image cropper workflow by locking selection to a 1:1 square to prevent distortion.',
            'Fixed crop interactions so selected regions can be resized reliably without forcing redraw.',
            'Added cropped logo preview support and corrected blob URL lifecycle so preview renders consistently.'
        ]
    },
    {
        version: 'v2.1.0',
        releasedAt: '2026-03-16T20:30:00Z',
        notes: [
            'Improved quick-template UX with single-select behavior and unified active outline state.',
            'Added artistic gradient eligibility guardrails with clearer inline guidance in Help.',
            'Added WiFi privacy reassurance so password entry is clearly presented as local-only browser processing.'
        ]
    },
    {
        version: 'v2.0.0',
        releasedAt: '2026-03-16T14:00:00Z',
        notes: [
            'Launched Versions, Activity, and Roadmap as a first-class product panel.',
            'Added release history, What\'s New syncing, and top-header version/date reference.',
            'Added private timeline source support and grouped release notes by commit type.'
        ]
    },
    {
        version: 'v1.4.1',
        releasedAt: '2026-03-14T22:45:00Z',
        notes: [
            'Added runtime Gemini model discovery and fallback handling.',
            'Added inline Google Place ID search support for review workflows.',
            'Improved CSP/API handling and reduced noisy retry logging.'
        ]
    },
    {
        version: 'v1.4.0',
        releasedAt: '2026-03-10T12:45:00Z',
        notes: [
            'Added Artistic/Brand Mode QR generation.',
            'Expanded use-case filtering and history controls.',
            'Improved print layout quality and guide readability.'
        ]
    },
    {
        version: 'v1.3.0',
        releasedAt: '2026-03-08T21:00:00Z',
        notes: [
            'Added hierarchical analytics tracking across core user actions.',
            'Completed industry guide tabs and print-focused documentation.',
            'Improved template reference flow and page-level UX polish.'
        ]
    },
    {
        version: 'v1.2.0',
        releasedAt: '2026-03-07T13:10:00Z',
        notes: [
            'Added undo/redo state history with persistence and dropdown navigation.',
            'Added error-correction and size guidance improvements.',
            'Expanded Google Review flow and quality recommendations.'
        ]
    },
    {
        version: 'v1.1.0',
        releasedAt: '2025-12-30T21:30:00Z',
        notes: [
            'Added Gemini-powered prompt suggestions and retry handling.',
            'Added metadata-enriched PNG/PDF exports and bucket enhancements.',
            'Improved sticky dual-panel layout and mobile scan reliability.'
        ]
    },
    {
        version: 'v1.0.5',
        releasedAt: '2025-12-28T19:45:00Z',
        notes: [
            'Published the live baseline snapshot before artistic QR expansion.',
            'Stabilized core QR generation and branding workflows for production use.'
        ]
    },
    {
        version: 'v1.0.0',
        releasedAt: '2025-12-27T23:00:00Z',
        notes: [
            'Launched core generator with logo support and downloads.',
            'Added template types, color/style controls, and analytics basics.',
            'Added thank-you page, SEO foundation, and production-ready footer/contact flow.'
        ]
    }
];

const FALLBACK_DEVELOPMENT_ACTIVITY = [
    {
        message: 'release: publish v2.5.0 with merchant draft persistence, place-phone status UX, and resolved-day alignment improvements',
        committedAt: '2026-06-28T19:35:00Z',
        author: 'Grant'
    },
    {
        message: 'release: publish v2.4.0 with merchant future event template, schedule gating, and invite export updates',
        committedAt: '2026-06-28T16:35:00Z',
        author: 'Grant'
    },
    {
        message: 'release: publish v2.3.0 with template isolation, privacy controls, and expanded dial codes',
        committedAt: '2026-03-21T16:10:00Z',
        author: 'Grant'
    },
    {
        message: 'feat: add settings shortcut to reopen privacy notice and review local storage preferences',
        committedAt: '2026-03-21T15:45:00Z',
        author: 'Grant'
    },
    {
        message: 'fix: isolate template payload state so event, phone, and manual flows do not cross over',
        committedAt: '2026-03-21T15:20:00Z',
        author: 'Grant'
    },
    {
        message: 'feat: expand international dial code coverage and add privacy banner with history opt-in',
        committedAt: '2026-03-21T14:55:00Z',
        author: 'Grant'
    },
    {
        message: 'feat: add Home Guest WiFi example and Instagram feedback loop roadmap item',
        committedAt: '2026-03-19T20:45:00Z',
        author: 'Grant'
    },
    {
        message: 'fix: lock cropper to 1:1 and improve crop resize interactions',
        committedAt: '2026-03-16T23:20:00Z',
        author: 'Grant'
    },
    {
        message: 'fix: preserve cropped logo preview blob lifecycle and apply-crop consistency',
        committedAt: '2026-03-16T22:55:00Z',
        author: 'Grant'
    },
    {
        message: 'ui: add roadmap tab layout',
        committedAt: '2026-03-14T22:14:00Z',
        author: 'Grant'
    },
    {
        message: 'fix: improve QR contrast validation logic',
        committedAt: '2026-03-14T21:03:00Z',
        author: 'Grant'
    },
    {
        message: 'refactor: tighten generator state handling',
        committedAt: '2026-03-13T19:55:00Z',
        author: 'Grant'
    }
];

const DEFAULT_ROADMAP_ITEMS = [
    {
        id: 'template-gallery',
        title: 'Template gallery for verticals',
        status: 'in-progress',
        targetVersion: 'v2.6',
        eta: 'May 2026',
        details: 'Filterable starter templates by industry and campaign objective.'
    },
    {
        id: 'logo-embedding',
        title: 'Reusable logo preset library',
        status: 'planned',
        targetVersion: 'v2.6',
        eta: 'May 2026',
        details: 'Save common logo placements and size presets for quick reuse.'
    },
    {
        id: 'dynamic-analytics',
        title: 'Dynamic scan analytics mode',
        status: 'backlog',
        targetVersion: 'v2.6',
        eta: 'Q2 2026',
        details: 'Track scans by campaign and date with dashboard snapshots.'
    },
    {
        id: 'ai-create-image',
        title: 'Artistic Create Image generator',
        status: 'planned',
        targetVersion: 'v2.6',
        eta: 'Q2 2026',
        details: 'Generate artistic backgrounds from prompts with quality and safety guardrails.'
    },
    {
        id: 'instagram-feedback-loop',
        title: 'Instagram user feedback loop',
        status: 'planned',
        targetVersion: 'v2.6',
        eta: 'Q2 2026',
        details: 'Capture user feedback through Instagram stories with linked paths to and from the QR tool.'
    }
];

const NEXT_RELEASE_TARGET = {
    version: 'v2.6',
    eta: 'Q4 2026',
    planned: [
        'Template gallery with guided setup',
        'Logo preset library improvements',
        'Expanded release timeline automation and publishing workflow',
        'Instagram-based feedback loop via linked stories and tool return paths'
    ]
};

let currentRoadmapItems = [];

function formatDateOnly(dateValue) {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return 'Date unavailable';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

function formatDateTime(dateValue) {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return 'Date unavailable';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function isOffHours(dateValue) {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return false;
    const day = date.getDay();
    if (day === 0 || day === 6) return true;
    const hour = date.getHours();
    return hour < RELEASE_TIMELINE_CONFIG.businessHoursStart || hour >= RELEASE_TIMELINE_CONFIG.businessHoursEnd;
}

function slugifyRoadmapId(input) {
    return String(input || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || `roadmap-${Date.now()}`;
}

function normalizeRoadmapStatus(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'in-progress' || normalized === 'in progress') return 'in-progress';
    if (normalized === 'planned') return 'planned';
    return 'backlog';
}

function summarizeReleaseBody(body) {
    if (!body) return ['Release improvements and maintenance updates.'];

    const lines = body
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    const bullets = lines
        .filter(line => /^[-*]\s+/.test(line))
        .map(line => line.replace(/^[-*]\s+/, ''))
        .slice(0, 4);

    if (bullets.length > 0) return bullets;

    const firstLine = lines[0] || '';
    return [firstLine.slice(0, 180) || 'Release improvements and maintenance updates.'];
}

function loadRoadmapItems() {
    try {
        const raw = localStorage.getItem(ROADMAP_STORAGE_KEY);
        if (!raw) return [...DEFAULT_ROADMAP_ITEMS];

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0) {
            return [...DEFAULT_ROADMAP_ITEMS];
        }

        const normalized = parsed
            .filter(item => item && item.title)
            .map(item => ({
                id: item.id || slugifyRoadmapId(item.title),
                title: item.title,
                status: normalizeRoadmapStatus(item.status),
                targetVersion: item.targetVersion || 'TBD',
                eta: item.eta || 'TBD',
                details: item.details || ''
            }));

        const existingIds = new Set(normalized.map(item => item.id));
        const missingDefaults = DEFAULT_ROADMAP_ITEMS.filter(item => !existingIds.has(item.id));
        return [...normalized, ...missingDefaults];
    } catch (error) {
        console.warn('Could not read roadmap from storage:', error);
        return [...DEFAULT_ROADMAP_ITEMS];
    }
}

function persistRoadmapItems(items) {
    try {
        localStorage.setItem(ROADMAP_STORAGE_KEY, JSON.stringify(items));
    } catch (error) {
        console.warn('Could not persist roadmap items:', error);
    }
}

function renderReleaseHistory(releases) {
    const container = document.getElementById('releaseHistoryList');
    if (!container) return;
    container.innerHTML = '';

    if (!releases || releases.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'No release history available yet.';
        container.appendChild(empty);
        return;
    }

    releases.forEach(release => {
        const card = document.createElement('article');
        card.className = 'timeline-item';

        const header = document.createElement('div');
        header.className = 'timeline-item-header';

        const title = document.createElement('span');
        title.className = 'timeline-item-title';
        title.textContent = release.version || 'Unnamed release';

        const date = document.createElement('span');
        date.className = 'timeline-item-meta';
        date.textContent = formatDateOnly(release.releasedAt);

        header.appendChild(title);
        header.appendChild(date);
        card.appendChild(header);

        const notes = Array.isArray(release.notes) ? release.notes : [];
        notes.slice(0, 4).forEach(note => {
            const noteItem = document.createElement('p');
            noteItem.className = 'timeline-item-meta';
            noteItem.textContent = `- ${note}`;
            card.appendChild(noteItem);
        });

        container.appendChild(card);
    });
}

function renderDevelopmentActivity(activity) {
    const container = document.getElementById('developmentActivityList');
    if (!container) return;
    container.innerHTML = '';

    if (!activity || activity.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'No recent commit activity available.';
        container.appendChild(empty);
        return;
    }

    activity.forEach(entry => {
        const card = document.createElement('article');
        card.className = 'timeline-item';

        const header = document.createElement('div');
        header.className = 'timeline-item-header';

        const title = document.createElement('span');
        title.className = 'timeline-item-title';
        title.textContent = entry.message || 'Commit update';

        const date = document.createElement('span');
        date.className = 'timeline-item-meta';
        date.textContent = formatDateTime(entry.committedAt);

        header.appendChild(title);
        header.appendChild(date);
        card.appendChild(header);

        const meta = document.createElement('div');
        meta.className = 'timeline-item-header';

        const author = document.createElement('span');
        author.className = 'timeline-item-meta';
        author.textContent = entry.author ? `By ${entry.author}` : 'Author unavailable';

        meta.appendChild(author);


        card.appendChild(meta);
        container.appendChild(card);
    });
}

function renderRoadmap(items) {
    const container = document.getElementById('roadmapItemsList');
    if (!container) return;
    container.innerHTML = '';

    if (!items || items.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'No roadmap items yet.';
        container.appendChild(empty);
        return;
    }

    items.forEach(item => {
        const row = document.createElement('article');
        row.className = 'roadmap-item';
        row.id = `roadmap-item-${item.id}`;

        const state = document.createElement('span');
        state.className = `roadmap-state ${normalizeRoadmapStatus(item.status)}`;
        state.textContent = normalizeRoadmapStatus(item.status).replace('-', ' ');

        const body = document.createElement('div');

        const title = document.createElement('p');
        title.className = 'timeline-item-title';
        title.textContent = item.title;

        const details = document.createElement('p');
        details.className = 'timeline-item-meta';
        details.textContent = item.details || 'Planned feature';

        body.appendChild(title);
        body.appendChild(details);

        const target = document.createElement('span');
        target.className = 'roadmap-target';
        target.textContent = `${item.targetVersion} • ${item.eta}`;

        row.appendChild(state);
        row.appendChild(body);
        row.appendChild(target);

        container.appendChild(row);
    });
}

function renderNextReleaseTarget(targetData) {
    const container = document.getElementById('nextReleaseTarget');
    if (!container) return;
    container.innerHTML = '';

    const headline = document.createElement('p');
    headline.className = 'timeline-item-title';
    headline.textContent = `${targetData.version} target - ${targetData.eta}`;

    container.appendChild(headline);

    if (Array.isArray(targetData.planned)) {
        targetData.planned.forEach(item => {
            const note = document.createElement('p');
            note.className = 'timeline-item-meta';
            note.textContent = `- ${item}`;
            container.appendChild(note);
        });
    }
}

function inferCommitCategory(message) {
    const normalized = String(message || '').trim().toLowerCase();
    if (!normalized) return 'other';

    const conventionalType = normalized.match(/^([a-z]+)(\(.+?\))?(!)?:/);
    const detectedType = conventionalType ? conventionalType[1] : '';

    if (detectedType === 'feat' || /^feature\b/.test(normalized)) return 'feat';
    if (detectedType === 'fix' || /^(bug|hotfix)\b/.test(normalized)) return 'fix';
    if (
        detectedType === 'ui' ||
        detectedType === 'ux' ||
        detectedType === 'style' ||
        detectedType === 'design' ||
        /\b(ui|ux|design|styling|layout|theme)\b/.test(normalized)
    ) {
        return 'ui';
    }
    if (
        detectedType === 'perf' ||
        detectedType === 'performance' ||
        /\b(perf|performance|optimi[sz]e|optimi[sz]ation|speed|latency)\b/.test(normalized)
    ) {
        return 'perf';
    }
    if (
        detectedType === 'docs' ||
        detectedType === 'doc' ||
        /\b(docs?|readme|changelog|documentation)\b/.test(normalized)
    ) {
        return 'docs';
    }

    return 'other';
}

function buildReleaseNoteGroups(activity) {
    const buckets = RELEASE_NOTE_GROUP_ORDER.reduce((acc, group) => {
        acc[group] = [];
        return acc;
    }, {});

    (Array.isArray(activity) ? activity : []).forEach(entry => {
        const message = String(entry?.message || '').trim();
        if (!message) return;
        const category = inferCommitCategory(message);
        buckets[category].push(message);
    });

    return RELEASE_NOTE_GROUP_ORDER
        .map(group => ({
            id: group,
            title: RELEASE_NOTE_GROUP_LABELS[group] || group,
            items: buckets[group]
        }))
        .filter(group => group.items.length > 0);
}

function renderReleaseNoteSections(activity) {
    const container = document.getElementById('releaseNoteSectionsList');
    if (!container) return;
    container.innerHTML = '';

    const groups = buildReleaseNoteGroups(activity);
    if (groups.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'No release-note sections yet.';
        container.appendChild(empty);
        return;
    }

    groups.forEach(group => {
        const card = document.createElement('article');
        card.className = 'release-notes-group';

        const title = document.createElement('h4');
        title.className = 'release-notes-group-title';
        title.textContent = `${group.title} (${group.items.length})`;
        card.appendChild(title);

        const list = document.createElement('ul');
        list.className = 'release-notes-list';

        group.items.slice(0, 8).forEach(message => {
            const item = document.createElement('li');
            item.textContent = message;
            list.appendChild(item);
        });

        card.appendChild(list);
        container.appendChild(card);
    });
}

function updateHeaderVersionReference(release) {
    const versionEl = document.getElementById('appVersionRef');
    const dateEl = document.getElementById('appVersionDate');
    if (!versionEl || !dateEl) return;

    if (!release) {
        versionEl.textContent = 'v--';
        dateEl.textContent = 'Date unavailable';
        return;
    }

    versionEl.textContent = release.version || 'Unnamed release';
    dateEl.textContent = `Released ${formatDateOnly(release.releasedAt)}`;
}

function primeHeaderVersionReference() {
    const fallbackRelease = Array.isArray(FALLBACK_RELEASE_HISTORY) && FALLBACK_RELEASE_HISTORY.length > 0
        ? FALLBACK_RELEASE_HISTORY[0]
        : null;
    updateHeaderVersionReference(fallbackRelease);
}

function updateWhatsNewBanner(release) {
    const banner = document.getElementById('whatsNewBanner');
    const summary = document.getElementById('whatsNewSummary');
    const dateLabel = document.getElementById('whatsNewDate');
    if (release) {
        updateHeaderVersionReference(release);
    }

    if (!banner || !summary || !dateLabel || !release) return;

    const releaseDate = new Date(release.releasedAt);
    if (Number.isNaN(releaseDate.getTime())) {
        banner.style.display = 'none';
        return;
    }

    const ageMs = Date.now() - releaseDate.getTime();
    const cutoffMs = RELEASE_TIMELINE_CONFIG.whatsNewVisibleDays * 24 * 60 * 60 * 1000;
    if (ageMs > cutoffMs) {
        banner.style.display = 'none';
        return;
    }

    const topNotes = Array.isArray(release.notes) ? release.notes.slice(0, 3) : [];
    summary.textContent = `${release.version} released with ${topNotes.join(' ')}`;
    dateLabel.textContent = `Released ${formatDateOnly(release.releasedAt)}`;
    banner.style.display = 'block';
}

function normalizeReleaseData(rawItems) {
    return (Array.isArray(rawItems) ? rawItems : []).map(release => ({
        version: release?.version || release?.tag || release?.tag_name || release?.name || 'Unnamed release',
        releasedAt: release?.releasedAt || release?.released_at || release?.published_at || release?.created_at,
        notes: Array.isArray(release?.notes) ? release.notes : summarizeReleaseBody(release?.body)
    }));
}

function normalizeCommitData(rawItems) {
    const normalized = (Array.isArray(rawItems) ? rawItems : []).map(item => {
        const fullMessage = item?.message || item?.title || item?.commit?.message || 'Commit update';
        const firstLine = String(fullMessage).split('\n')[0];
        return {
            message: firstLine,
            committedAt: item?.committedAt || item?.committed_at || item?.timestamp || item?.commit?.committer?.date || item?.commit?.author?.date,
            author: item?.author || item?.authorName || item?.commit?.author?.name || item?.author?.login || 'Unknown'
        };
    });

    return sanitizeDevelopmentActivityTimes(normalized);
}

async function fetchPrivateTimelineData() {
    if (RELEASE_TIMELINE_CONFIG.dataSource !== 'private') {
        throw new Error('Private timeline source is disabled in RELEASE_TIMELINE_CONFIG.');
    }

    const endpoint = String(RELEASE_TIMELINE_CONFIG.privateTimelineEndpoint || '').trim();
    if (!endpoint) {
        throw new Error('No private timeline endpoint configured.');
    }

    const response = await fetch(endpoint, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
        cache: 'no-store'
    });

    if (!response.ok) {
        throw new Error(`Private timeline fetch failed: ${response.status}`);
    }

    const payload = await response.json();
    const releasesRaw = payload?.releases || payload?.releaseHistory || payload?.data?.releases || [];
    const commitsRaw = payload?.commits || payload?.developmentActivity || payload?.activity || payload?.data?.commits || [];

    return {
        releases: normalizeReleaseData(releasesRaw),
        commits: normalizeCommitData(commitsRaw)
    };
}

function openIndustryTab(tabName) {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    const targetButton = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    const targetContent = document.getElementById(`${tabName}-tab`);

    if (!targetButton || !targetContent) return;

    tabButtons.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));

    targetButton.classList.add('active');
    targetContent.classList.add('active');
}

function setupVersionsRoadmapNavigation() {
    const viewRoadmapBtn = document.getElementById('viewRoadmapBtn');
    const latestReleaseBtn = document.getElementById('viewLatestReleaseBtn');
    const openVersionsRoadmapBtn = document.getElementById('openVersionsRoadmapBtn');
    const roadmapList = document.getElementById('roadmapItemsList');

    if (viewRoadmapBtn) {
        viewRoadmapBtn.addEventListener('click', () => {
            openIndustryTab('versions-roadmap');
            document.getElementById('versions-roadmap-tab')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }

    if (latestReleaseBtn) {
        latestReleaseBtn.addEventListener('click', () => {
            openIndustryTab('versions-roadmap');
            document.getElementById('releaseHistoryList')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }

    if (openVersionsRoadmapBtn) {
        openVersionsRoadmapBtn.addEventListener('click', () => {
            openIndustryTab('versions-roadmap');
            document.getElementById('versions-roadmap-tab')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }

    document.querySelectorAll('.coming-soon-btn').forEach(button => {
        button.addEventListener('click', () => {
            const roadmapId = button.getAttribute('data-roadmap-link');
            openIndustryTab('versions-roadmap');

            if (!roadmapId || !roadmapList) return;

            const target = document.getElementById(`roadmap-item-${roadmapId}`);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                target.style.boxShadow = '0 0 0 2px rgba(102, 126, 234, 0.25)';
                setTimeout(() => {
                    target.style.boxShadow = '';
                }, 1600);
            }
        });
    });
}

async function initializeVersionsRoadmapPanel() {
    currentRoadmapItems = loadRoadmapItems();
    renderRoadmap(currentRoadmapItems);
    renderNextReleaseTarget(NEXT_RELEASE_TARGET);

    let releases = [...FALLBACK_RELEASE_HISTORY];
    let commits = [...FALLBACK_DEVELOPMENT_ACTIVITY];

    // Immediately render fallback release metadata so header is never blank.
    updateHeaderVersionReference(releases[0]);

    try {
        const timelineData = await fetchPrivateTimelineData();

        if (timelineData.releases.length > 0) {
            releases = timelineData.releases;
        }

        if (timelineData.commits.length > 0) {
            commits = timelineData.commits;
        }
    } catch (error) {
        console.warn('Private timeline source unavailable, using fallback timeline data:', error);
    }

    commits = sanitizeDevelopmentActivityTimes(commits);

    renderReleaseHistory(releases);
    renderDevelopmentActivity(commits);
    renderReleaseNoteSections(commits);
    updateHeaderVersionReference(releases[0]);
    updateWhatsNewBanner(releases[0]);
}

window.addRoadmapItem = function addRoadmapItem(title, targetVersion = 'TBD', eta = 'TBD', status = 'backlog', details = '') {
    if (!title || typeof title !== 'string') return;

    const item = {
        id: slugifyRoadmapId(title),
        title: title.trim(),
        targetVersion,
        eta,
        status: normalizeRoadmapStatus(status),
        details
    };

    currentRoadmapItems = [...currentRoadmapItems, item];
    persistRoadmapItems(currentRoadmapItems);
    renderRoadmap(currentRoadmapItems);
};

// Industry Tab Navigation
document.addEventListener('DOMContentLoaded', function() {
    // Prime with fallback before any async timeline fetches.
    primeHeaderVersionReference();

    const tabButtons = document.querySelectorAll('.tab-btn');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const targetTab = this.getAttribute('data-tab');
            openIndustryTab(targetTab);
            
            // Analytics: Track tab view
            if (typeof gtag !== 'undefined') {
                gtag('event', 'industry_tab_viewed', {
                    'tab_name': targetTab
                });
            }
        });
    });

    setupVersionsRoadmapNavigation();
    initializeVersionsRoadmapPanel().catch(error => {
        console.warn('Versions and roadmap panel initialization failed:', error);
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
        'merchant-future-event': 'merchant-future-event',
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
// Load privacy preference from localStorage
function initializePrivacy() {
    const savedPref = localStorage.getItem(PRIVACY_PREF_KEY);
    if (savedPref !== null) {
        privacyOptInPreference = savedPref === 'true';
    }
    setupPrivacyBannerEventListeners();
}

function setupPrivacyBannerEventListeners() {
    const optInCheckbox = document.getElementById('privacyOptIn');
    const dismissBtn = document.getElementById('dismissPrivacyBtn');
    const detailsLink = document.querySelector('.privacy-banner-text a');
    const settingsBtn = document.getElementById('settingsBtn');

    if (optInCheckbox) {
        optInCheckbox.checked = privacyOptInPreference;
        optInCheckbox.addEventListener('change', function() {
            privacyOptInPreference = this.checked;
            localStorage.setItem(PRIVACY_PREF_KEY, String(privacyOptInPreference));
            const message = privacyOptInPreference ? 
                '✓ History saving enabled' : 
                '⊘ History saving disabled - your data will not be saved to this browser';
            showNotification(message, 'info');
        });
    }
    
    if (dismissBtn) {
        dismissBtn.addEventListener('click', function() {
            const banner = document.getElementById('privacyBanner');
            if (banner) {
                banner.style.display = 'none';
                localStorage.setItem('privacy_banner_dismissed', 'true');
            }
        });
    }

    if (settingsBtn) {
        settingsBtn.addEventListener('click', function() {
            const banner = document.getElementById('privacyBanner');
            if (banner) {
                banner.style.display = 'block';
                localStorage.removeItem('privacy_banner_dismissed');
            }
            const details = document.getElementById('privacyDetails');
            if (details) {
                details.style.display = 'block';
            }
        });
    }
}

function togglePrivacyDetails(event) {
    event.preventDefault();
    const details = document.getElementById('privacyDetails');
    if (details) {
        const isVisible = details.style.display !== 'none';
        details.style.display = isVisible ? 'none' : 'block';
    }
}

// Initialize privacy settings
initializePrivacy();

// Hide banner if user previously dismissed it
if (localStorage.getItem('privacy_banner_dismissed') === 'true') {
    const banner = document.getElementById('privacyBanner');
    if (banner) {
        banner.style.display = 'none';
    }
}

// Initialize template data cache (one data slot per template type)
templateDataCache = {};

// Initialize merchant schedule controls and persisted settings
initializeMerchantSchedulePanel();

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