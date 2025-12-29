# QR Code Metadata & PDF Export Feature

## Overview
This feature adds comprehensive metadata tracking and dual PDF export capabilities to the QR Code Generator, allowing users to document, organize, and export their QR codes with complete settings information.

## New Features

### 1. 📝 Notes Field
- **Location**: Main page, below the QR Code Label field
- **Purpose**: Allow users to add descriptive notes for each QR code
- **Use Cases**: 
  - Document what each QR code is for
  - Add context for future reference
  - Include deployment locations or usage instructions
- **Example**: "WiFi password for conference room B - expires June 2026"

### 2. 🗂️ Metadata Tracking
The system now captures and stores complete metadata for each QR code added to the collection:

#### Core Data
- Text/URL content
- Label text
- User notes
- Creation timestamp

#### Settings
- QR code size
- Border size
- Logo size percentage
- Label size percentage

#### Colors
- Dark color (hex value)
- Light color (hex value)
- Label color (hex value)

#### Style
- QR code pattern style (squares, dots, rounded)

#### Logo Information
- Whether a logo is present
- Logo image data (if applicable)

#### Artistic QR Settings (if used)
- Background image presence
- Background image data
- Blend mode
- Background opacity percentage
- QR code strength percentage

### 3. 📊 Metadata PDF Export
**Button**: "📊 Metadata PDF" (Blue button)

**What It Includes**:
- Title page with generation date and total QR code count
- For each QR code:
  - QR code image (50mm × 50mm)
  - Label and notes
  - Creation timestamp
  - Complete content/text data
  - All settings in organized columns
  - Color specifications
  - Logo information
  - Artistic QR settings (if applicable)
  - Background image preview (if applicable)

**Use Cases**:
- Complete documentation for archival purposes
- Recreating QR codes with exact same settings
- Sharing configuration details with team members
- Technical reference documentation

**Filename**: `qr-codes-metadata.pdf`

### 4. 📄 Printable PDF Export
**Button**: "📄 Printable PDF" (Green button)

**Layout**:
- Clean, professional design
- QR code on the left (55% of page width, up to 60mm)
- Notes section on the right (45% of page width)
- Label text below each QR code
- Reference numbers for each code

**Notes Section Features**:
- If notes were entered: Displays the notes in a bordered box
- If no notes: Provides ruled lines for manual note-taking
- Bordered box for clear separation

**Use Cases**:
- Physical reference sheets to keep with QR code deployments
- Print and distribute to team members
- Quick reference guides
- On-site documentation

**Filename**: `qr-codes-printable.pdf`

## How to Use

### Basic Workflow

1. **Generate a QR Code**
   - Enter your content (URL, text, contact info, etc.)
   - Customize as desired (colors, style, logo, artistic features)
   - Optionally add a label
   - **NEW**: Add notes describing what this QR code is for
   - Click "Generate QR Code"

2. **Add to Collection**
   - Click "Add to Bucket" button
   - The QR code is saved with all its metadata
   - Notes field clears automatically for the next code

3. **Repeat for Multiple Codes**
   - Generate as many QR codes as needed (up to 10)
   - Each one stores its unique settings and notes

4. **Export Your Collection**

   **Option A - Metadata PDF** (Complete Documentation)
   - Click "📊 Metadata PDF"
   - Get a comprehensive reference document
   - Perfect for: Archiving, recreation, technical documentation

   **Option B - Printable PDF** (Clean Reference Sheet)
   - Click "📄 Printable PDF"
   - Get a printer-friendly document
   - Perfect for: Physical reference, team distribution, on-site guides

   **Option C - Original PDF Grid**
   - Click "PDF Grid" (existing feature)
   - Get a 2×4 grid layout (up to 8 codes)
   - Perfect for: Compact printing, multiple codes per page

### Tips for Best Results

1. **Be Descriptive with Notes**
   - Include location information: "Main entrance QR code"
   - Add dates: "Valid until December 2025"
   - Include context: "Backup WiFi for guests"

2. **Use Labels for Display**
   - Labels appear on the QR code itself
   - Notes are for your reference only
   - Labels are short, notes can be detailed

3. **Organize Your Collection**
   - Add similar QR codes together (e.g., all event codes)
   - Use consistent naming in notes
   - Consider downloading separate PDFs for different projects

4. **Recreating QR Codes**
   - Use the Metadata PDF to see exact settings
   - Note the slider values, colors, and blend modes
   - Match all parameters to recreate identical codes

## Technical Details

### Data Structure
Each QR code in the bucket stores:
```javascript
{
    dataURL: "data:image/png;base64,...",
    canvas: HTMLCanvasElement,
    metadata: {
        text: string,
        label: string,
        notes: string,
        timestamp: number,
        settings: {
            size: number,
            border: number,
            logoSize: number,
            labelSize: number
        },
        colors: {
            dark: string,
            light: string,
            label: string
        },
        style: string,
        logo: {
            hasLogo: boolean,
            logoDataURL: string | null
        },
        artistic: {
            hasBackground: boolean,
            backgroundDataURL: string | null,
            blendMode: string,
            bgOpacity: number,
            qrStrength: number
        }
    }
}
```

### PDF Specifications

**Metadata PDF**:
- Format: A4 Portrait (210mm × 297mm)
- Margins: 15mm
- QR code size: 50mm × 50mm
- Font sizes: 8-24pt (hierarchical)
- Multi-page support: Automatic page breaks

**Printable PDF**:
- Format: A4 Portrait (210mm × 297mm)
- Margins: 15mm
- QR code size: Up to 60mm (maintains aspect ratio)
- Notes box: Bordered with ruled lines if empty
- Clean, professional layout

## Future Enhancements (Potential)
- Export metadata as JSON for import/recreation
- Search and filter QR codes by notes
- Categorization/tagging system
- Batch edit notes
- Export individual QR code metadata

## Browser Compatibility
- Requires modern browser with jsPDF support
- Works in Chrome, Firefox, Edge, Safari (latest versions)
- PDF generation happens client-side (no server required)

## Privacy & Security
- All processing happens in the browser
- No data sent to external servers
- Metadata stored only in browser memory
- Cleared when page is refreshed or closed
- Downloaded PDFs contain only your data

---

Created: December 29, 2025
Branch: metadata
