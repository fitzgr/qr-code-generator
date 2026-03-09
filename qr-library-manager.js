/**
 * QR Library Manager - Multi-API Abstraction Layer
 * Provides unified interface for multiple QR code generation libraries
 */

// ===== FEATURE DEFINITIONS =====
const QRFeatures = {
    BASIC_GENERATION: 'basic_generation',
    CANVAS_OUTPUT: 'canvas_output',
    SVG_OUTPUT: 'svg_output',
    PNG_OUTPUT: 'png_output',
    LOGO_EMBEDDING: 'logo_embedding',
    COLOR_CUSTOMIZATION: 'color_customization',
    GRADIENT_SUPPORT: 'gradient_support',
    DOT_STYLING: 'dot_styling',
    CORNER_STYLING: 'corner_styling',
    BACKGROUND_IMAGE: 'background_image',
    TRANSPARENT_BG: 'transparent_bg',
    ERROR_CORRECTION: 'error_correction',
    HIGH_RESOLUTION: 'high_resolution',
    FAST_GENERATION: 'fast_generation',
    QR_DECODING: 'qr_decoding'
};

// ===== LIBRARY COMPATIBILITY MAP =====
const LibraryCapabilities = {
    'qrcodejs': {
        name: 'QRCode.js',
        url: 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
        priority: 1, // Current library, fallback
        features: {
            [QRFeatures.BASIC_GENERATION]: true,
            [QRFeatures.CANVAS_OUTPUT]: true,
            [QRFeatures.ERROR_CORRECTION]: true,
            [QRFeatures.FAST_GENERATION]: true,
            // Limitations
            [QRFeatures.SVG_OUTPUT]: false,
            [QRFeatures.PNG_OUTPUT]: false,
            [QRFeatures.LOGO_EMBEDDING]: false,
            [QRFeatures.GRADIENT_SUPPORT]: false,
            [QRFeatures.DOT_STYLING]: false,
            [QRFeatures.CORNER_STYLING]: false,
            [QRFeatures.BACKGROUND_IMAGE]: false
        },
        performance: 'fast',
        fileSize: 'tiny'
    },
    
    'qr-code-styling': {
        name: 'QR Code Styling',
        url: 'https://cdn.jsdelivr.net/npm/qr-code-styling@1.6.0-rc.1/lib/qr-code-styling.js',
        priority: 10, // Best for artistic QR codes
        features: {
            [QRFeatures.BASIC_GENERATION]: true,
            [QRFeatures.CANVAS_OUTPUT]: true,
            [QRFeatures.SVG_OUTPUT]: true,
            [QRFeatures.PNG_OUTPUT]: true,
            [QRFeatures.LOGO_EMBEDDING]: true,
            [QRFeatures.COLOR_CUSTOMIZATION]: true,
            [QRFeatures.GRADIENT_SUPPORT]: true,
            [QRFeatures.DOT_STYLING]: true,
            [QRFeatures.CORNER_STYLING]: true,
            [QRFeatures.TRANSPARENT_BG]: true,
            [QRFeatures.ERROR_CORRECTION]: true,
            [QRFeatures.HIGH_RESOLUTION]: true,
            // Limitations
            [QRFeatures.BACKGROUND_IMAGE]: false,
            [QRFeatures.FAST_GENERATION]: false // Slower due to features
        },
        performance: 'medium',
        fileSize: 'medium'
    },
    
    'awesome-qr': {
        name: 'Awesome QR',
        url: 'https://cdn.jsdelivr.net/npm/awesome-qr@2.1.5/dist/awesome-qr.min.js',
        priority: 9, // Best for background images
        features: {
            [QRFeatures.BASIC_GENERATION]: true,
            [QRFeatures.CANVAS_OUTPUT]: true,
            [QRFeatures.PNG_OUTPUT]: true,
            [QRFeatures.LOGO_EMBEDDING]: true,
            [QRFeatures.COLOR_CUSTOMIZATION]: true,
            [QRFeatures.BACKGROUND_IMAGE]: true,
            [QRFeatures.TRANSPARENT_BG]: true,
            [QRFeatures.ERROR_CORRECTION]: true,
            // Limitations
            [QRFeatures.SVG_OUTPUT]: false,
            [QRFeatures.GRADIENT_SUPPORT]: false,
            [QRFeatures.DOT_STYLING]: false,
            [QRFeatures.CORNER_STYLING]: false
        },
        performance: 'slow',
        fileSize: 'medium'
    },
    
    'qrcode': {
        name: 'node-qrcode',
        url: 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js',
        priority: 7, // Good for SVG/PNG export
        features: {
            [QRFeatures.BASIC_GENERATION]: true,
            [QRFeatures.CANVAS_OUTPUT]: true,
            [QRFeatures.SVG_OUTPUT]: true,
            [QRFeatures.PNG_OUTPUT]: true,
            [QRFeatures.COLOR_CUSTOMIZATION]: true,
            [QRFeatures.ERROR_CORRECTION]: true,
            [QRFeatures.HIGH_RESOLUTION]: true,
            [QRFeatures.FAST_GENERATION]: true,
            // Limitations
            [QRFeatures.LOGO_EMBEDDING]: false,
            [QRFeatures.GRADIENT_SUPPORT]: false,
            [QRFeatures.DOT_STYLING]: false,
            [QRFeatures.CORNER_STYLING]: false,
            [QRFeatures.BACKGROUND_IMAGE]: false
        },
        performance: 'fast',
        fileSize: 'small'
    },
    
    'kjua': {
        name: 'kjua',
        url: 'https://cdn.jsdelivr.net/npm/kjua@0.9.0/dist/kjua.min.js',
        priority: 6,
        features: {
            [QRFeatures.BASIC_GENERATION]: true,
            [QRFeatures.CANVAS_OUTPUT]: true,
            [QRFeatures.PNG_OUTPUT]: true,
            [QRFeatures.LOGO_EMBEDDING]: true,
            [QRFeatures.COLOR_CUSTOMIZATION]: true,
            [QRFeatures.ERROR_CORRECTION]: true,
            // Limitations
            [QRFeatures.SVG_OUTPUT]: false,
            [QRFeatures.GRADIENT_SUPPORT]: false,
            [QRFeatures.DOT_STYLING]: false,
            [QRFeatures.CORNER_STYLING]: false,
            [QRFeatures.BACKGROUND_IMAGE]: false
        },
        performance: 'fast',
        fileSize: 'tiny'
    }
};

// ===== UNIFIED OPTIONS SCHEMA =====
const UnifiedOptions = {
    // Content
    text: null,
    
    // Size
    width: 256,
    height: 256,
    
    // Error correction
    errorCorrectionLevel: 'M', // L, M, Q, H
    
    // Colors
    colorDark: '#000000',
    colorLight: '#ffffff',
    
    // Gradient (if supported)
    gradient: null, // { type: 'linear'|'radial', colorStops: [...] }
    
    // Logo
    logo: null, // { src: '...', width: 80, height: 80 }
    
    // Styling
    dotsOptions: null, // { type: 'rounded'|'dots'|'classy'|'square', color: '...' }
    cornersSquareOptions: null, // { type: 'dot'|'square'|'extra-rounded', color: '...' }
    cornersDotOptions: null, // { type: 'dot'|'square', color: '...' }
    
    // Background
    backgroundOptions: null, // { color: '...', image: '...' }
    
    // Output format
    format: 'canvas', // 'canvas', 'svg', 'png', 'dataURL'
    
    // Performance
    quietZone: 4,
    
    // Artistic mode
    artistic: false
};

// ===== LIBRARY LOADER =====
class LibraryLoader {
    constructor() {
        this.loadedLibraries = new Set();
        this.loadingPromises = new Map();
    }
    
    async loadLibrary(libraryKey) {
        if (this.loadedLibraries.has(libraryKey)) {
            return true;
        }
        
        if (this.loadingPromises.has(libraryKey)) {
            return this.loadingPromises.get(libraryKey);
        }
        
        const library = LibraryCapabilities[libraryKey];
        if (!library) {
            throw new Error(`Unknown library: ${libraryKey}`);
        }
        
        const promise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = library.url;
            script.onload = () => {
                this.loadedLibraries.add(libraryKey);
                this.loadingPromises.delete(libraryKey);
                console.log(`✅ Loaded ${library.name}`);
                resolve(true);
            };
            script.onerror = () => {
                this.loadingPromises.delete(libraryKey);
                console.error(`❌ Failed to load ${library.name}`);
                reject(new Error(`Failed to load ${library.name}`));
            };
            document.head.appendChild(script);
        });
        
        this.loadingPromises.set(libraryKey, promise);
        return promise;
    }
    
    isLoaded(libraryKey) {
        return this.loadedLibraries.has(libraryKey);
    }
}

// ===== LIBRARY SELECTION LOGIC =====
class LibrarySelector {
    static selectBestLibrary(requiredFeatures, preferredLibrary = null) {
        // If preferred library supports all features, use it
        if (preferredLibrary && LibraryCapabilities[preferredLibrary]) {
            const lib = LibraryCapabilities[preferredLibrary];
            if (this.librarySupportsFeatures(preferredLibrary, requiredFeatures)) {
                return preferredLibrary;
            }
        }
        
        // Find all compatible libraries
        const compatible = Object.keys(LibraryCapabilities).filter(key => 
            this.librarySupportsFeatures(key, requiredFeatures)
        );
        
        if (compatible.length === 0) {
            console.warn('No library supports all requested features. Using fallback.');
            return 'qrcodejs'; // Fallback to current library
        }
        
        // Sort by priority (descending)
        compatible.sort((a, b) => 
            LibraryCapabilities[b].priority - LibraryCapabilities[a].priority
        );
        
        return compatible[0];
    }
    
    static librarySupportsFeatures(libraryKey, features) {
        const lib = LibraryCapabilities[libraryKey];
        if (!lib) return false;
        
        return features.every(feature => lib.features[feature] === true);
    }
    
    static getRequiredFeatures(options) {
        const features = [QRFeatures.BASIC_GENERATION];
        
        if (options.format === 'svg') {
            features.push(QRFeatures.SVG_OUTPUT);
        } else if (options.format === 'png' || options.format === 'dataURL') {
            features.push(QRFeatures.PNG_OUTPUT);
        } else {
            features.push(QRFeatures.CANVAS_OUTPUT);
        }
        
        if (options.logo) {
            features.push(QRFeatures.LOGO_EMBEDDING);
        }
        
        if (options.gradient) {
            features.push(QRFeatures.GRADIENT_SUPPORT);
        }
        
        if (options.dotsOptions) {
            features.push(QRFeatures.DOT_STYLING);
        }
        
        if (options.cornersSquareOptions || options.cornersDotOptions) {
            features.push(QRFeatures.CORNER_STYLING);
        }
        
        if (options.backgroundOptions?.image) {
            features.push(QRFeatures.BACKGROUND_IMAGE);
        }
        
        if (options.artistic) {
            features.push(QRFeatures.DOT_STYLING, QRFeatures.CORNER_STYLING);
        }
        
        return features;
    }
}

// ===== LIBRARY WRAPPERS =====
class QRCodeJSAdapter {
    static generate(container, options) {
        return new Promise((resolve, reject) => {
            try {
                // Clear container
                container.innerHTML = '';
                
                const qrcode = new QRCode(container, {
                    text: options.text,
                    width: options.width,
                    height: options.height,
                    colorDark: options.colorDark,
                    colorLight: options.colorLight,
                    correctLevel: this.mapErrorCorrection(options.errorCorrectionLevel)
                });
                
                // Wait for canvas to be created
                setTimeout(() => {
                    const canvas = container.querySelector('canvas');
                    if (canvas) {
                        resolve({ canvas, library: 'qrcodejs' });
                    } else {
                        reject(new Error('Canvas not created'));
                    }
                }, 100);
            } catch (error) {
                reject(error);
            }
        });
    }
    
    static mapErrorCorrection(level) {
        const map = { L: QRCode.CorrectLevel.L, M: QRCode.CorrectLevel.M, Q: QRCode.CorrectLevel.Q, H: QRCode.CorrectLevel.H };
        return map[level] || QRCode.CorrectLevel.M;
    }
}

class QRCodeStylingAdapter {
    static async generate(container, options) {
        return new Promise((resolve, reject) => {
            try {
                const config = {
                    width: options.width,
                    height: options.height,
                    type: options.format === 'svg' ? 'svg' : 'canvas',
                    data: options.text,
                    margin: options.quietZone || 0,
                    qrOptions: {
                        typeNumber: 0,
                        mode: 'Byte',
                        errorCorrectionLevel: options.errorCorrectionLevel
                    },
                    dotsOptions: options.dotsOptions || {
                        color: options.colorDark,
                        type: 'square'
                    },
                    backgroundOptions: {
                        color: options.colorLight,
                        ...options.backgroundOptions
                    },
                    cornersSquareOptions: options.cornersSquareOptions,
                    cornersDotOptions: options.cornersDotOptions
                };
                
                // Add logo if provided
                if (options.logo) {
                    config.image = options.logo.src;
                    config.imageOptions = {
                        hideBackgroundDots: true,
                        imageSize: 0.4,
                        margin: 0
                    };
                }
                
                // Add gradient if provided
                if (options.gradient) {
                    config.dotsOptions.gradient = options.gradient;
                }
                
                const qrCode = new QRCodeStyling(config);
                
                // Clear container
                container.innerHTML = '';
                
                // Append to container
                qrCode.append(container);
                
                setTimeout(() => {
                    const element = container.querySelector('canvas, svg');
                    resolve({ element, library: 'qr-code-styling', qrCodeInstance: qrCode });
                }, 100);
            } catch (error) {
                reject(error);
            }
        });
    }
}

class NodeQRCodeAdapter {
    static async generate(container, options) {
        return new Promise((resolve, reject) => {
            try {
                const config = {
                    errorCorrectionLevel: options.errorCorrectionLevel,
                    type: options.format === 'svg' ? 'svg' : 'image/png',
                    quality: 1,
                    margin: options.quietZone || 4,
                    color: {
                        dark: options.colorDark,
                        light: options.colorLight
                    },
                    width: options.width
                };
                
                if (options.format === 'svg') {
                    QRCode.toString(options.text, { ...config, type: 'svg' }, (err, svg) => {
                        if (err) {
                            reject(err);
                        } else {
                            container.innerHTML = svg;
                            resolve({ element: container.querySelector('svg'), library: 'qrcode' });
                        }
                    });
                } else {
                    QRCode.toDataURL(options.text, config, (err, url) => {
                        if (err) {
                            reject(err);
                        } else {
                            const img = document.createElement('img');
                            img.src = url;
                            container.innerHTML = '';
                            container.appendChild(img);
                            resolve({ element: img, library: 'qrcode', dataURL: url });
                        }
                    });
                }
            } catch (error) {
                reject(error);
            }
        });
    }
}

class KjuaAdapter {
    static generate(container, options) {
        return new Promise((resolve, reject) => {
            try {
                const config = {
                    text: options.text,
                    size: options.width,
                    fill: options.colorDark,
                    back: options.colorLight,
                    ecLevel: options.errorCorrectionLevel,
                    quiet: options.quietZone || 0,
                    mode: 'plain',
                    mSize: 30,
                    mPosX: 50,
                    mPosY: 50
                };
                
                // Add logo if provided
                if (options.logo) {
                    config.mode = 'image';
                    config.image = options.logo.src;
                }
                
                const canvas = kjua(config);
                container.innerHTML = '';
                container.appendChild(canvas);
                
                resolve({ canvas, library: 'kjua' });
            } catch (error) {
                reject(error);
            }
        });
    }
}

// ===== UNIFIED QR MANAGER =====
class QRLibraryManager {
    constructor() {
        this.loader = new LibraryLoader();
        this.currentLibrary = null;
        this.preferredLibrary = null;
    }
    
    async generate(container, options) {
        // Determine required features
        const requiredFeatures = LibrarySelector.getRequiredFeatures(options);
        
        // Select best library
        const selectedLibrary = LibrarySelector.selectBestLibrary(requiredFeatures, this.preferredLibrary);
        
        console.log(`📊 Required features:`, requiredFeatures);
        console.log(`🎯 Selected library: ${LibraryCapabilities[selectedLibrary].name}`);
        
        // Load library if needed
        if (!this.loader.isLoaded(selectedLibrary)) {
            console.log(`⏳ Loading ${LibraryCapabilities[selectedLibrary].name}...`);
            await this.loader.loadLibrary(selectedLibrary);
        }
        
        // Generate QR code with selected library
        this.currentLibrary = selectedLibrary;
        return this.generateWithLibrary(selectedLibrary, container, options);
    }
    
    async generateWithLibrary(libraryKey, container, options) {
        switch (libraryKey) {
            case 'qrcodejs':
                return QRCodeJSAdapter.generate(container, options);
            
            case 'qr-code-styling':
                return QRCodeStylingAdapter.generate(container, options);
            
            case 'qrcode':
                return NodeQRCodeAdapter.generate(container, options);
            
            case 'kjua':
                return KjuaAdapter.generate(container, options);
            
            default:
                throw new Error(`No adapter for library: ${libraryKey}`);
        }
    }
    
    setPreferredLibrary(libraryKey) {
        if (LibraryCapabilities[libraryKey]) {
            this.preferredLibrary = libraryKey;
        } else {
            console.warn(`Unknown library: ${libraryKey}`);
        }
    }
    
    getAvailableLibraries() {
        return Object.keys(LibraryCapabilities).map(key => ({
            key,
            name: LibraryCapabilities[key].name,
            features: LibraryCapabilities[key].features,
            priority: LibraryCapabilities[key].priority,
            loaded: this.loader.isLoaded(key)
        }));
    }
    
    getLibraryCapabilities(libraryKey) {
        return LibraryCapabilities[libraryKey];
    }
}

// ===== EXPORT =====
window.QRLibraryManager = QRLibraryManager;
window.QRFeatures = QRFeatures;
window.LibraryCapabilities = LibraryCapabilities;
