# Metadata System Architecture

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                          │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  INPUT FIELDS                                                    │
│  • Text/URL                                                      │
│  • Label (optional)                                              │
│  • Notes (optional) ◄── NEW                                     │
│  • Logo (optional)                                               │
│  • Background (optional)                                         │
│  • Settings (sliders)                                            │
│  • Colors (pickers)                                              │
│  • Style (buttons)                                               │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
                   ┌───────────────────────┐
                   │  Click "Generate QR"  │
                   └───────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    QR CODE GENERATION                            │
│  • Generates QR code image                                       │
│  • Applies colors, style, logo                                   │
│  • Blends with background if present                             │
│  • Renders on canvas                                             │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
                   ┌───────────────────────┐
                   │ Click "Add to Bucket" │
                   └───────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│               METADATA CAPTURE ◄── NEW                          │
│                                                                  │
│  metadata = {                                                    │
│    text: "URL or text content",                                 │
│    label: "User label",                                          │
│    notes: "User notes", ◄── NEW                                 │
│    timestamp: 1735501234567,                                     │
│    settings: {                                                   │
│      size: 10,                                                   │
│      border: 2,                                                  │
│      logoSize: 25,                                               │
│      labelSize: 100                                              │
│    },                                                            │
│    colors: {                                                     │
│      dark: "#000000",                                            │
│      light: "#ffffff",                                           │
│      label: "#000000"                                            │
│    },                                                            │
│    style: "squares",                                             │
│    logo: {                                                       │
│      hasLogo: true/false,                                        │
│      logoDataURL: "data:image/..."                              │
│    },                                                            │
│    artistic: {                                                   │
│      hasBackground: true/false,                                  │
│      backgroundDataURL: "data:image/...",                       │
│      blendMode: "overlay",                                       │
│      bgOpacity: 50,                                              │
│      qrStrength: 80                                              │
│    }                                                             │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                   STORAGE IN MEMORY                              │
│                                                                  │
│  qrBucket[index] = {                                             │
│    dataURL: "data:image/png;base64,...",                        │
│    canvas: HTMLCanvasElement,                                    │
│    metadata: { ... } ◄── NEW STRUCTURE                          │
│  }                                                               │
│                                                                  │
│  qrMetadataHistory[] ◄── NEW ARRAY                              │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
              ┌────────────────┴────────────────┐
              │                                 │
              ▼                                 ▼
┌─────────────────────────┐      ┌─────────────────────────┐
│  EXISTING DOWNLOADS     │      │   NEW PDF DOWNLOADS     │
│                         │      │                         │
│  • PNG Zip              │      │  📊 Metadata PDF        │
│  • JPG Zip              │      │     • Full docs         │
│  • PDF Grid (2×4)       │      │     • All settings      │
│                         │      │     • Recreation guide  │
│                         │      │                         │
│                         │      │  📄 Printable PDF       │
│                         │      │     • Clean layout      │
│                         │      │     • QR + notes        │
│                         │      │     • Print-friendly    │
└─────────────────────────┘      └─────────────────────────┘
```

## Metadata PDF Generation Flow

```
START: User clicks "📊 Metadata PDF"
  │
  ├─► Check if qrBucket.length > 0
  │     │
  │     ├─► NO: Alert "Please add QR codes first"
  │     │     └─► STOP
  │     │
  │     └─► YES: Continue
  │
  ├─► Create jsPDF instance (A4, portrait)
  │
  ├─► Add title page
  │     ├─► Title: "QR Code Metadata Documentation"
  │     ├─► Date/time generated
  │     └─► Total count
  │
  ├─► FOR EACH QR code in bucket:
  │     │
  │     ├─► Check if need new page (yPos > 197mm)
  │     │     └─► YES: pdf.addPage()
  │     │
  │     ├─► Add section header (QR Code #N)
  │     │
  │     ├─► Add QR image (50mm × 50mm)
  │     │
  │     ├─► Add metadata beside image:
  │     │     ├─► Label
  │     │     ├─► Notes (wrapped text)
  │     │     └─► Timestamp
  │     │
  │     ├─► Add content/text (3 lines max)
  │     │
  │     ├─► Add settings in 2 columns:
  │     │     ├─► Column 1: Size, border, logo, label, style
  │     │     └─► Column 2: Colors, has logo
  │     │
  │     ├─► IF artistic.hasBackground:
  │     │     ├─► Add artistic settings
  │     │     └─► Add background image preview (40mm)
  │     │
  │     └─► Add separator line
  │
  ├─► pdf.save('qr-codes-metadata.pdf')
  │
  └─► Show notification
```

## Printable PDF Generation Flow

```
START: User clicks "📄 Printable PDF"
  │
  ├─► Check if qrBucket.length > 0
  │     │
  │     ├─► NO: Alert "Please add QR codes first"
  │     │     └─► STOP
  │     │
  │     └─► YES: Continue
  │
  ├─► Create jsPDF instance (A4, portrait)
  │
  ├─► Add title: "QR Codes Reference Sheet"
  │
  ├─► FOR EACH QR code in bucket:
  │     │
  │     ├─► Check if need new page (yPos > 217mm)
  │     │     └─► YES: pdf.addPage()
  │     │
  │     ├─► Calculate layout:
  │     │     ├─► QR width: 55% of page (max 60mm)
  │     │     └─► Notes width: 40% of page
  │     │
  │     ├─► Add QR code image (left side)
  │     │
  │     ├─► Add label below QR code (if present)
  │     │
  │     ├─► Add notes section (right side):
  │     │     ├─► Header: "Notes:"
  │     │     │
  │     │     ├─► IF metadata.notes exists:
  │     │     │     ├─► Display notes text
  │     │     │     └─► Draw border box
  │     │     │
  │     │     └─► ELSE (notes empty):
  │     │           ├─► Placeholder text
  │     │           ├─► Draw border box
  │     │           └─► Draw ruled lines (every 6mm)
  │     │
  │     ├─► Add reference number (#N)
  │     │
  │     └─► Advance yPos
  │
  ├─► pdf.save('qr-codes-printable.pdf')
  │
  └─► Show notification
```

## Component Interaction Diagram

```
┌──────────────┐
│  textInput   │──┐
└──────────────┘  │
                  │
┌──────────────┐  │
│  labelInput  │──┤
└──────────────┘  │
                  │
┌──────────────┐  │    ┌─────────────────┐     ┌──────────────┐
│ qrNotesInput │──┼───►│  generateQRCode │────►│  qrCanvas    │
└──────────────┘  │    └─────────────────┘     └──────────────┘
                  │                                     │
┌──────────────┐  │                                     │
│   Sliders    │──┤                                     │
└──────────────┘  │                                     ▼
                  │                            ┌──────────────────┐
┌──────────────┐  │                            │  currentQRDataURL│
│ Color Pickers│──┤                            └──────────────────┘
└──────────────┘  │                                     │
                  │                                     │
┌──────────────┐  │                                     ▼
│ Style Buttons│──┤                            ┌──────────────────┐
└──────────────┘  │        Click                │  addQRToBucket() │
                  │    "Add to Bucket"          └──────────────────┘
┌──────────────┐  │                                     │
│  logoInput   │──┤                                     │
└──────────────┘  │                                     ▼
                  │                            ┌──────────────────┐
┌──────────────┐  │                            │  Capture all     │
│ bgImageInput │──┘                            │  current values  │
└──────────────┘                               └──────────────────┘
                                                        │
                                                        ▼
                                               ┌──────────────────┐
                                               │    qrBucket[]    │
                                               │  + metadata{}    │
                                               └──────────────────┘
                                                        │
                        ┌──────────────┬────────────────┼────────────────┬──────────────┐
                        │              │                │                │              │
                        ▼              ▼                ▼                ▼              ▼
                  ┌──────────┐  ┌──────────┐    ┌──────────┐    ┌──────────┐  ┌──────────┐
                  │ PNG Zip  │  │ JPG Zip  │    │ PDF Grid │    │ Metadata │  │Printable │
                  └──────────┘  └──────────┘    └──────────┘    │   PDF    │  │   PDF    │
                                                                 └──────────┘  └──────────┘
                                                                     NEW           NEW
```

## State Management

```
APPLICATION STATE
│
├─ currentQRDataURL (string)
│   └─ Currently displayed QR code as data URL
│
├─ qrBucket[] (array of objects)
│   ├─ [0] { dataURL, canvas, metadata }
│   ├─ [1] { dataURL, canvas, metadata }
│   └─ ... (up to 10 items)
│
├─ qrMetadataHistory[] (array of metadata objects) ◄── NEW
│   ├─ [0] { text, label, notes, timestamp, settings, ... }
│   ├─ [1] { text, label, notes, timestamp, settings, ... }
│   └─ ... (unlimited history)
│
├─ Current Settings (live values)
│   ├─ selectedLogo
│   ├─ backgroundImage
│   ├─ currentDarkColor
│   ├─ currentLightColor
│   ├─ currentQRStyle
│   ├─ currentBlendMode
│   ├─ currentBgOpacity
│   └─ currentQrStrength
│
└─ UI Elements (DOM references)
    ├─ Input fields
    ├─ Buttons
    ├─ Canvas
    └─ Preview containers
```

---

This architecture ensures:
- ✅ Complete metadata capture at creation time
- ✅ No data loss when settings change
- ✅ Flexible export options
- ✅ Easy recreation of QR codes
- ✅ Backward compatibility
