# QR Code Generator Web App

A beautiful, client-side QR code generator with logo support. No backend required!

## 🚀 Quick Start

Simply open `index.html` in your browser to use the app locally.

## 📦 Features

- Generate QR codes from any text or URL
- Add custom logos to the center of QR codes
- Adjustable QR code size, border, and logo size
- Download QR codes as PNG images
- Fully responsive design
- Works completely offline (after initial load)
- No server or backend required

## 🌐 Deploy to GitHub Pages

### Step 1: Create a GitHub Repository

1. Go to [GitHub](https://github.com) and sign in
2. Click the **+** icon (top right) → **New repository**
3. Name it: `qr-generator` (or any name you like)
4. Choose **Public**
5. **DO NOT** initialize with README
6. Click **Create repository**

### Step 2: Push Your Code to GitHub

Open PowerShell in the `qr_code_generator_web` folder and run:

```powershell
# Initialize git repository
git init

# Add all files
git add .

# Commit files
git commit -m "Initial commit: QR code generator web app"

# Add your GitHub repository (REPLACE 'yourusername' with your actual GitHub username)
git remote add origin https://github.com/yourusername/qr-generator.git

# Push to GitHub
git branch -M main
git push -u origin main
```

**Note:** Replace `yourusername` with your actual GitHub username!

### Step 3: Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings** (top menu)
3. Click **Pages** (left sidebar)
4. Under **Source**, select **main** branch
5. Click **Save**
6. Wait 1-2 minutes

Your site will be live at: `https://yourusername.github.io/qr-generator/`

## 💰 Add PayPal Donation Button

### Get Your PayPal Donation Link:

1. Go to [PayPal](https://www.paypal.com)
2. Log in to your account
3. Go to **Tools** → **All Tools** → **PayPal Buttons**
4. Select **Donate** button
5. Customize and generate the button
6. Copy the link or button code

### Add to Your App:

Open `index.html` and find this section (around line 53):

```html
<!-- REPLACE WITH YOUR PAYPAL BUTTON CODE -->
<div id="paypal-button-container">
    <a href="#" id="paypal-link" class="btn btn-donate" target="_blank">
        ☕ Donate via PayPal
    </a>
</div>
```

**Replace the `href="#"` with your PayPal link:**

```html
<a href="https://www.paypal.com/donate/?hosted_button_id=YOUR_BUTTON_ID" 
   id="paypal-link" class="btn btn-donate" target="_blank">
    ☕ Donate via PayPal
</a>
```

Or paste the entire PayPal button code there.

## 🔧 Custom Domain (Optional)

### Buy a Domain
- Namecheap.com (~$15/year)
- Google Domains / Squarespace (~$15/year)
- Cloudflare (~$10/year)

### Configure DNS

Add these DNS records in your domain registrar:

```
Type: A     | Name: @   | Value: 185.199.108.153
Type: A     | Name: @   | Value: 185.199.109.153
Type: A     | Name: @   | Value: 185.199.110.153
Type: A     | Name: @   | Value: 185.199.111.153
Type: CNAME | Name: www | Value: yourusername.github.io
```

### Configure GitHub Pages

1. Go to repository **Settings** → **Pages**
2. Enter your custom domain (e.g., `myqrcodes.com`)
3. Enable **Enforce HTTPS**
4. Wait 10-30 minutes for DNS to propagate

## 📱 What You'll Need to Provide Me:

To set up PayPal integration, I need:
1. **Your PayPal email** (or PayPal.me link)
2. **Your PayPal hosted button ID** (if you create a button)

Or just:
- Your PayPal.me link (e.g., `https://paypal.me/yourusername`)

## 🎨 Customization

- **Colors:** Edit `style.css` - change the gradient colors
- **Logo size limits:** Edit `app.js` - adjust `logoSizeRange` min/max
- **Default values:** Edit `app.js` - change default size/border values

## 📄 Files Structure

```
qr_code_generator_web/
├── index.html      # Main HTML structure
├── style.css       # All styling
├── app.js          # QR generation logic
└── README.md       # This file
```

## 🆓 Costs

- **Hosting:** FREE (GitHub Pages)
- **Domain:** ~$15/year (optional)
- **PayPal fees:** ~2.9% + $0.30 per transaction

## 🛠️ Tech Stack

- Pure HTML/CSS/JavaScript
- [QRCode.js](https://davidshimjs.github.io/qrcodejs/) library
- Canvas API for logo overlay
- No build process or dependencies

## 📝 License

Free to use and modify!
