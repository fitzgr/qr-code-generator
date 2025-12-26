// QR Code Generator Web App
let selectedLogo = null;
let currentQRDataURL = null;

// DOM Elements
const textInput = document.getElementById('textInput');
const logoInput = document.getElementById('logoInput');
const selectLogoBtn = document.getElementById('selectLogoBtn');
const clearLogoBtn = document.getElementById('clearLogoBtn');
const logoStatus = document.getElementById('logoStatus');
const generateBtn = document.getElementById('generateBtn');
const downloadPngBtn = document.getElementById('downloadPngBtn');
const downloadSvgBtn = document.getElementById('downloadSvgBtn');
const downloadJpgBtn = document.getElementById('downloadJpgBtn');
const clearBtn = document.getElementById('clearBtn');
const qrCanvas = document.getElementById('qrCanvas');
const previewPlaceholder = document.getElementById('previewPlaceholder');

// Range inputs
const sizeRange = document.getElementById('sizeRange');
const borderRange = document.getElementById('borderRange');
const logoSizeRange = document.getElementById('logoSizeRange');
const sizeValue = document.getElementById('sizeValue');
const borderValue = document.getElementById('borderValue');
const logoSizeValue = document.getElementById('logoSizeValue');

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
});

// Generate QR Code
generateBtn.addEventListener('click', generateQRCode);

function generateQRCode() {
    const text = textInput.value.trim();
    
    if (!text) {
        alert('Please enter some text or URL!');
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
        
        // Generate QR code
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
            const qrImage = tempDiv.querySelector('img');
            
            if (qrImage && qrImage.complete) {
                drawQRWithLogo(qrImage, qrSize);
                document.body.removeChild(tempDiv);
            } else if (qrImage) {
                qrImage.onload = () => {
                    drawQRWithLogo(qrImage, qrSize);
                    document.body.removeChild(tempDiv);
                };
            }
        }, 100);
        
    } catch (error) {
        alert('Failed to generate QR code: ' + error.message);
        console.error(error);
    }
}

function drawQRWithLogo(qrImage, qrSize) {
    const ctx = qrCanvas.getContext('2d');
    
    // Set canvas size
    qrCanvas.width = qrSize;
    qrCanvas.height = qrSize;
    
    // Draw QR code
    ctx.drawImage(qrImage, 0, 0, qrSize, qrSize);
    
    // Add logo if selected
    if (selectedLogo) {
        const logoSizePercent = parseInt(logoSizeRange.value) / 100;
        const logoSize = Math.floor(qrSize * logoSizePercent);
        const logoPos = (qrSize - logoSize) / 2;
        
        // Draw white background for logo
        const padding = 10;
        ctx.fillStyle = 'white';
        ctx.fillRect(
            logoPos - padding,
            logoPos - padding,
            logoSize + padding * 2,
            logoSize + padding * 2
        );
        
        // Draw logo
        ctx.drawImage(selectedLogo, logoPos, logoPos, logoSize, logoSize);
    }
    
    // Show canvas and hide placeholder
    qrCanvas.classList.add('visible');
    previewPlaceholder.classList.add('hidden');
    
    // Store the data URL for download
    currentQRDataURL = qrCanvas.toDataURL('image/png');
    
    // Show success message
    showNotification('QR Code generated successfully!');
}

// Download QR Code as PNG
downloadPngBtn.addEventListener('click', () => {
    if (!currentQRDataURL) {
        alert('Please generate a QR code first!');
        return;
    }
    
    const link = document.createElement('a');
    link.download = 'qr-code.png';
    link.href = currentQRDataURL;
    link.click();
    
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
    showNotification('QR Code downloaded as SVG!');
});

// Download QR Code as JPG
downloadJpgBtn.addEventListener('click', () => {
    if (!currentQRDataURL) {
        alert('Please generate a QR code first!');
        return;
    }
    
    // Convert PNG to JPG (with white background)
    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = qrCanvas.width;
        canvas.height = qrCanvas.height;
        const ctx = canvas.getContext('2d');
        
        // Fill white background (JPG doesn't support transparency)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        
        const link = document.createElement('a');
        link.download = 'qr-code.jpg';
        link.href = canvas.toDataURL('image/jpeg', 0.95);
        link.click();
        
        showNotification('QR Code downloaded as JPG!');
    };
    img.src = currentQRDataURL;
});

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
    selectedLogo = null;
    logoInput.value = '';
    logoStatus.textContent = 'No logo selected';
    logoStatus.style.color = '#888';
    sizeRange.value = 10;
    borderRange.value = 2;
    logoSizeRange.value = 25;
    sizeValue.textContent = '10';
    borderValue.textContent = '2';
    logoSizeValue.textContent = '25';
    
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
