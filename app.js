// QR Code Generator Web App
let selectedLogo = null;
let currentQRDataURL = null;
let currentQRStyle = 'squares';
let currentDarkColor = '#000000';
let currentLightColor = '#ffffff';
let currentLabelColor = '#000000';

// Artistic QR Code variables
let backgroundImage = null;
let currentBlendMode = 'overlay';
let currentBgOpacity = 50;
let currentQrStrength = 80;
let isGeneratingAI = false;

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
const downloadPngBtn = document.getElementById('downloadPngBtn');
const downloadSvgBtn = document.getElementById('downloadSvgBtn');
const downloadJpgBtn = document.getElementById('downloadJpgBtn');
const downloadPdfBtn = document.getElementById('downloadPdfBtn');
const clearBtn = document.getElementById('clearBtn');
const qrCanvas = document.getElementById('qrCanvas');
const previewPlaceholder = document.getElementById('previewPlaceholder');

// Bucket elements
const addToBucketBtn = document.getElementById('addToBucketBtn');
const bucketCount = document.getElementById('bucketCount');
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

// Color inputs
const darkColorPicker = document.getElementById('darkColorPicker');
const lightColorPicker = document.getElementById('lightColorPicker');
const darkColorText = document.getElementById('darkColorText');
const lightColorText = document.getElementById('lightColorText');
const labelColorPicker = document.getElementById('labelColorPicker');
const labelColorText = document.getElementById('labelColorText');
const colorPresets = document.querySelectorAll('.color-preset');
const styleBtns = document.querySelectorAll('.style-btn');

// Quick template buttons
const templateBtns = document.querySelectorAll('.template-btn');

templateBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const template = btn.dataset.template;
        let templateText = '';
        
        switch(template) {
            case 'url':
                templateText = 'https://';
                break;
            case 'email':
                templateText = 'mailto:your@email.com';
                break;
            case 'phone':
                templateText = 'tel:+1234567890';
                break;
            case 'sms':
                templateText = 'sms:+1234567890?body=Your message here';
                break;
            case 'wifi':
                templateText = 'WIFI:T:WPA;S:NetworkName;P:Password;;';
                break;
            case 'vcard':
                templateText = 'BEGIN:VCARD\nVERSION:3.0\nFN:Full Name\nTEL:+1234567890\nEMAIL:email@example.com\nORG:Company Name\nTITLE:Job Title\nEND:VCARD';
                break;
            case 'geo':
                templateText = 'geo:37.7749,-122.4194,100';
                break;
        }
        
        textInput.value = templateText;
        textInput.focus();
        
        // Select the template text for easy editing
        if (template === 'url') {
            textInput.setSelectionRange(8, 8); // Place cursor after https://
        } else {
            textInput.select();
        }
    });
});

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
            gtag('event', 'color_preset_selected', {
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
    if (currentQRDataURL) {
        generateQRCode();
    }
});

lightColorPicker.addEventListener('input', (e) => {
    const color = e.target.value;
    lightColorText.value = color;
    currentLightColor = color;
    colorPresets.forEach(b => b.classList.remove('active'));
    if (currentQRDataURL) {
        generateQRCode();
    }
});

darkColorText.addEventListener('input', (e) => {
    let color = e.target.value;
    if (/^#[0-9A-F]{6}$/i.test(color)) {
        darkColorPicker.value = color;
        currentDarkColor = color;
        colorPresets.forEach(b => b.classList.remove('active'));
        if (currentQRDataURL) {
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
        if (currentQRDataURL) {
            generateQRCode();
        }
    }
});

labelColorPicker.addEventListener('input', (e) => {
    const color = e.target.value;
    labelColorText.value = color;
    currentLabelColor = color;
    if (currentQRDataURL) {
        generateQRCode();
    }
});

labelColorText.addEventListener('input', (e) => {
    let color = e.target.value;
    if (/^#[0-9A-F]{6}$/i.test(color)) {
        labelColorPicker.value = color;
        currentLabelColor = color;
        if (currentQRDataURL) {
            generateQRCode();
        }
    }
});

// Style buttons
styleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        currentQRStyle = btn.dataset.style;
        styleBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Track style selection
        if (typeof gtag !== 'undefined') {
            gtag('event', 'style_selected', {
                'style': currentQRStyle
            });
        }
    });
});

// Convert hex color to RGB
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

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
        generateQRCode();
    }
});

borderRange.addEventListener('change', (e) => {
    if (currentQRDataURL) {
        generateQRCode();
    }
});

logoSizeRange.addEventListener('change', (e) => {
    if (currentQRDataURL) {
        generateQRCode();
    }
});

labelSizeRange.addEventListener('change', (e) => {
    if (currentQRDataURL) {
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
            const img = new Image();
            img.onload = () => {
                backgroundImage = img;
                bgImageStatus.textContent = `Background: ${file.name}`;
                bgImageStatus.style.color = '#4CAF50';
                bgPreviewImage.src = event.target.result;
                bgPreviewSection.style.display = 'block';
                blendControlsSection.style.display = 'block';
                updateValidationStatus('idle', 'Click "Generate QR Code" to test');
                if (currentQRDataURL) {
                    generateQRCode();
                }
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }
});

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
        
        // Hide progress bar
        const progressContainer = document.getElementById('aiProgressContainer');
        if (progressContainer) {
            progressContainer.style.display = 'none';
            const progressBar = document.getElementById('aiProgressBar');
            if (progressBar) {
                progressBar.style.width = '0%';
            }
        }
        
        aiImageStatus.innerHTML = 'Generation cancelled. <strong>Next steps:</strong> Upload an image or try again later.';
        aiImageStatus.style.color = '#757575';
        console.log('🚫 User cancelled AI generation');
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
        aiImageStatus.textContent = 'Vision rendered successfully! ✨';
        aiImageStatus.style.color = '#4CAF50';
        
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
        
        if (currentQRDataURL) {
            generateQRCode();
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
                
                if (currentQRDataURL) {
                    generateQRCode();
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
    const maxPollAttempts = 60; // 60 attempts * 2 seconds = 2 minutes max
    
    while (attempts < maxPollAttempts) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds between polls
        attempts++;
        
        // Check if cancelled
        if (cancelAIGeneration) {
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
                
                // Load the image
                return new Promise((resolve, reject) => {
                    const img = new Image();
                    img.crossOrigin = 'anonymous';
                    
                    img.onload = () => {
                        console.log('✅ Stable Horde image loaded successfully!');
                        resolve(img);
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
            
            aiImageStatus.textContent = `In queue: position ${checkData.queue_position} (${waitTimeFormatted} estimated) • ${elapsedFormatted} elapsed`;
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
        generateQRCode();
    }
});

bgOpacityRange.addEventListener('input', (e) => {
    bgOpacityValue.textContent = e.target.value;
});

bgOpacityRange.addEventListener('change', (e) => {
    currentBgOpacity = parseInt(e.target.value);
    if (currentQRDataURL && backgroundImage) {
        generateQRCode();
    }
});

qrStrengthRange.addEventListener('input', (e) => {
    qrStrengthValue.textContent = e.target.value;
});

qrStrengthRange.addEventListener('change', (e) => {
    currentQrStrength = parseInt(e.target.value);
    if (currentQRDataURL && backgroundImage) {
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
    const context = contextInput.value.trim().toLowerCase();
    
    if (!context) {
        alert('Please enter what your QR code is for (e.g., "coffee shop business card")');
        contextInput.focus();
        return;
    }
    
    // Generate 3 prompt suggestions based on context
    const suggestions = createPromptSuggestions(context);
    
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
            const img = new Image();
            img.onload = () => {
                selectedLogo = img;
                logoStatus.textContent = `Logo: ${file.name}`;
                logoStatus.style.color = '#4CAF50';
            };
            img.src = event.target.result;
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
        generateQRCode();
    }
});

// Clear label
clearLabelBtn.addEventListener('click', () => {
    labelInput.value = '';
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
        
        // Logo
        logo: {
            hasLogo: selectedLogo !== null,
            logoDataURL: selectedLogo ? selectedLogo.src : null
        },
        
        // Artistic QR
        artistic: {
            hasBackground: backgroundImage !== null,
            backgroundDataURL: backgroundImage ? bgPreviewImage.src : null,
            blendMode: currentBlendMode,
            bgOpacity: currentBgOpacity,
            qrStrength: currentQrStrength
        }
    };
    
    // Store QR code data with metadata
    const qrData = {
        dataURL: currentQRDataURL,
        canvas: cloneCanvas(qrCanvas),
        metadata: metadata
    };
    
    qrBucket.push(qrData);
    qrMetadataHistory.push(metadata);
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
    bucketCount.textContent = `(${qrBucket.length}/${MAX_BUCKET_SIZE_OTHER})`;
    
    if (qrBucket.length > 0) {
        bucketSection.style.display = 'block';
        
        // Update preview thumbnails
        bucketPreview.innerHTML = '';
        qrBucket.forEach((qr, index) => {
            const item = document.createElement('div');
            item.className = 'bucket-item';
            
            const img = document.createElement('img');
            img.src = qr.dataURL;
            img.alt = `QR ${index + 1}`;
            
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

function removeFromBucket(index) {
    qrBucket.splice(index, 1);
    updateBucketUI();
    showNotification('Removed from bucket');
}

function clearBucket() {
    if (qrBucket.length === 0) return;
    
    if (confirm(`Clear all ${qrBucket.length} QR codes from bucket?`)) {
        qrBucket = [];
        updateBucketUI();
        showNotification('Bucket cleared');
    }
}

// Generate QR Code
generateBtn.addEventListener('click', generateQRCode);

function generateQRCode() {
    const text = textInput.value.trim();
    
    if (!text) {
        alert('Please enter some text or URL!');
        return;
    }
    
    // Validate contrast
    const contrastCheck = validateContrast(currentDarkColor, currentLightColor);
    if (!contrastCheck.valid) {
        alert(`⚠️ Color Contrast Too Low!\n\nThe colors you selected don't have enough contrast for QR codes to scan reliably.\n\nContrast ratio: ${contrastCheck.ratio}:1 (minimum: 3.0:1)\n\nPlease choose colors with more contrast:\n• Dark QR code on light background\n• Light QR code on dark background\n• Use the color presets for safe combinations`);
        return;
    }

    try {
        // Clear previous QR code
        qrCanvas.getContext('2d').clearRect(0, 0, qrCanvas.width, qrCanvas.height);
        
        // QR code settings
        const size = parseInt(sizeRange.value);
        const border = parseInt(borderRange.value);
        const qrSize = size * 32; // Scale up for better quality
        
        // Create temporary container for QR generation
        const tempDiv = document.createElement('div');
        tempDiv.style.display = 'none';
        document.body.appendChild(tempDiv);
        
        // Generate QR code - ALWAYS use black/white for generation, we'll recolor later
        const qr = new QRCode(tempDiv, {
            text: text,
            width: qrSize,
            height: qrSize,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
        });
        
        // Wait for QR code to be generated
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
        
        ctx.fillStyle = currentLabelColor;
        ctx.font = `bold ${fontSize}px Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        
        // Wrap text if too long (max width is QR code width)
        const maxWidth = qrSize;
        const words = label.split(' ');
        let line = '';
        let y = qrSize + padding + labelGap; // Start after QR code + gap
        
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
        
        ctx.fillStyle = currentLabelColor;
        ctx.font = `bold ${fontSize}px Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top'; // Changed to 'top' for better positioning
        
        // Wrap text if too long (max width is QR code width)
        const maxWidth = qrSize;
        const words = label.split(' ');
        let line = '';
        let y = qrSize + padding + labelGap; // Start after QR code + gap
        
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
            
            ctx.fillStyle = currentLabelColor;
            ctx.font = `bold ${fontSize}px Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            
            const maxWidth = qrSize;
            const words = label.split(' ');
            let line = '';
            let y = qrSize + padding + labelGap;
            
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
    
    // Update UI
    document.getElementById('qrVersion').textContent = version;
    document.getElementById('qrModules').textContent = `${modules}×${modules}`;
    document.getElementById('qrMinSize').textContent = `${minSizeMM}mm (${minSizeInch}\")`;
    
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
    
    // 4. Print Size (15 points)
    const printSizeMM = Math.ceil(qrSize / 10); // Rough estimate
    if (printSizeMM > 100) {
        score += 15;
    } else if (printSizeMM >= 50) {
        score += 12;
    } else if (printSizeMM >= 30) {
        score += 8;
    } else {
        score += 3;
        recommendations.push({
            type: 'info',
            icon: 'ℹ️',
            text: 'Small QR code may be hard to scan. ',
            actionText: 'Increase size to 15',
            action: () => {
                sizeRange.value = 15;
                sizeValue.textContent = '15';
                generateQRCode();
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
                    document.querySelector('.style-btn[data-style=\"squares\"]').click();
                    generateQRCode();
                }
            });
        }
    }
    
    // 6. Artistic QR Mode (affects score if active)
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
downloadPngBtn.addEventListener('click', () => {
    if (!currentQRDataURL) {
        alert('Please generate a QR code first!');
        return;
    }
    
    const label = labelInput.value.trim();
    
    // Download the preview canvas (which already includes label if present)
    const link = document.createElement('a');
    link.download = 'qr-code.png';
    link.href = currentQRDataURL;
    link.click();
    
    // Track download
    if (typeof gtag !== 'undefined') {
        gtag('event', 'download', {
            'format': 'PNG',
            'has_label': label ? 'yes' : 'no'
        });
    }
    
    showNotification('QR Code downloaded as PNG!');
});

// Download QR Code as SVG
downloadSvgBtn.addEventListener('click', () => {
    if (!currentQRDataURL) {
        alert('Please generate a QR code first!');
        return;
    }
    
    // Convert canvas to SVG
    const svg = canvasToSVG();
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.download = 'qr-code.svg';
    link.href = url;
    link.click();
    
    URL.revokeObjectURL(url);
    
    // Track download
    if (typeof gtag !== 'undefined') {
        gtag('event', 'download', {
            'format': 'SVG'
        });
    }
    
    showNotification('QR Code downloaded as SVG!');
});

// Download QR Code as JPG
downloadJpgBtn.addEventListener('click', () => {
    if (!currentQRDataURL) {
        alert('Please generate a QR code first!');
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
    link.download = 'qr-code.jpg';
    link.href = canvas.toDataURL('image/jpeg', 0.95);
    link.click();
    
    // Track download
    if (typeof gtag !== 'undefined') {
        gtag('event', 'download', {
            'format': 'JPG',
            'has_label': label ? 'yes' : 'no'
        });
    }
    
    showNotification('QR Code downloaded as JPG!');
});

// Download QR Code as PDF
downloadPdfBtn.addEventListener('click', () => {
    if (!currentQRDataURL) {
        alert('Please generate a QR code first!');
        return;
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
    pdf.save('qr-code.pdf');
    
    // Track download
    if (typeof gtag !== 'undefined') {
        gtag('event', 'download', {
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
    
    if (qrBucket.length > MAX_BUCKET_SIZE_PDF) {
        alert(`PDF can only include ${MAX_BUCKET_SIZE_PDF} QR codes. Please remove ${qrBucket.length - MAX_BUCKET_SIZE_PDF} code(s).`);
        return;
    }
    
    // Create PDF with 2 columns × 4 rows grid
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
    
    const cellWidth = (pageWidth - margin * (cols + 1)) / cols;
    const cellHeight = (pageHeight - margin * (rows + 1)) / rows;
    
    // Use the smaller dimension to maintain aspect ratio
    const qrSize = Math.min(cellWidth, cellHeight);
    
    qrBucket.forEach((qr, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        
        const x = margin + col * (qrSize + margin);
        const y = margin + row * (cellHeight + margin);
        
        // Calculate image dimensions maintaining aspect ratio
        const imgAspect = qr.canvas.height / qr.canvas.width;
        let imgWidth = qrSize;
        let imgHeight = qrSize * imgAspect;
        
        // Center the image in the cell if it's shorter than the cell
        const yOffset = (cellHeight - imgHeight) / 2;
        
        pdf.addImage(qr.dataURL, 'PNG', x, y + yOffset, imgWidth, imgHeight);
    });
    
    pdf.save('qr-codes-batch.pdf');
    showNotification(`${qrBucket.length} QR codes downloaded as PDF grid!`);
    
    if (typeof gtag !== 'undefined') {
        gtag('event', 'batch_download', {
            'format': 'PDF',
            'count': qrBucket.length
        });
    }
});

downloadBucketPngBtn.addEventListener('click', async () => {
    if (qrBucket.length === 0) {
        alert('Please add QR codes to the bucket first!');
        return;
    }
    
    // Create a zip file with all PNG images
    const JSZip = window.JSZip ? window.JSZip : null;
    if (!JSZip) {
        // Fallback: download individually
        qrBucket.forEach((qr, index) => {
            const link = document.createElement('a');
            const fileName = qr.label ? `${qr.label.replace(/[^a-z0-9]/gi, '_')}.png` : `qr-code-${index + 1}.png`;
            link.download = fileName;
            link.href = qr.dataURL;
            link.click();
        });
        showNotification(`${qrBucket.length} PNG files downloaded!`);
        return;
    }
    
    const zip = new JSZip();
    qrBucket.forEach((qr, index) => {
        const fileName = qr.label ? `${qr.label.replace(/[^a-z0-9]/gi, '_')}.png` : `qr-code-${index + 1}.png`;
        const base64 = qr.dataURL.split(',')[1];
        zip.file(fileName, base64, {base64: true});
    });
    
    const blob = await zip.generateAsync({type: 'blob'});
    const link = document.createElement('a');
    link.download = 'qr-codes.zip';
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
    
    showNotification(`${qrBucket.length} PNG files downloaded as ZIP!`);
    
    if (typeof gtag !== 'undefined') {
        gtag('event', 'batch_download', {
            'format': 'PNG_ZIP',
            'count': qrBucket.length
        });
    }
});

downloadBucketJpgBtn.addEventListener('click', async () => {
    if (qrBucket.length === 0) {
        alert('Please add QR codes to the bucket first!');
        return;
    }
    
    // Convert all to JPG and create zip
    const JSZip = window.JSZip ? window.JSZip : null;
    if (!JSZip) {
        // Fallback: download individually
        qrBucket.forEach((qr, index) => {
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
        showNotification(`${qrBucket.length} JPG files downloaded!`);
        return;
    }
    
    const zip = new JSZip();
    qrBucket.forEach((qr, index) => {
        const canvas = document.createElement('canvas');
        canvas.width = qr.canvas.width;
        canvas.height = qr.canvas.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(qr.canvas, 0, 0);
        
        const fileName = qr.label ? `${qr.label.replace(/[^a-z0-9]/gi, '_')}.jpg` : `qr-code-${index + 1}.jpg`;
        const base64 = canvas.toDataURL('image/jpeg', 0.95).split(',')[1];
        zip.file(fileName, base64, {base64: true});
    });
    
    const blob = await zip.generateAsync({type: 'blob'});
    const link = document.createElement('a');
    link.download = 'qr-codes.zip';
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
    
    showNotification(`${qrBucket.length} JPG files downloaded as ZIP!`);
    
    if (typeof gtag !== 'undefined') {
        gtag('event', 'batch_download', {
            'format': 'JPG_ZIP',
            'count': qrBucket.length
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
        
        pdf.save('qr-codes-metadata.pdf');
        showNotification(`Metadata PDF with ${qrBucket.length} QR codes downloaded!`);
        
        if (typeof gtag !== 'undefined') {
            gtag('event', 'metadata_pdf_download', {
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
        
        pdf.save('qr-codes-printable.pdf');
        showNotification(`Printable PDF with ${qrBucket.length} QR codes downloaded!`);
        
        if (typeof gtag !== 'undefined') {
            gtag('event', 'printable_pdf_download', {
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