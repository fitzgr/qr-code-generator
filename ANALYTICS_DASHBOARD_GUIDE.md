# QR Code Generator - Analytics Dashboard Setup Guide

**Google Analytics Property ID:** G-ESSRNC6XGC

This guide will help you create a comprehensive dashboard in **Looker Studio** to visualize all 60+ events we're tracking.

---

## 🚀 Quick Setup (10 minutes)

### Step 0: Important - What You'll See in Looker Studio

When you open Looker Studio, you'll see:
- **Toolbar at top** with buttons: Add chart, Add control, Add text, etc.
- **Canvas in center** where you build your dashboard
- **Properties panel on right** (appears when you select something)

**Common chart names:**
- ✅ **"Scorecard"** = Single large number (what we want for totals)
- ✅ **"Table"** = Data in rows/columns
- ✅ **"Bar chart"** = Horizontal or vertical bars
- ✅ **"Time series"** = Line chart showing trends over time

### Step 1: Create Looker Studio Report
1. Go to [Looker Studio](https://lookerstudio.google.com)
2. Click **Create** → **Report**
3. Click **Add Data** → Search for "Google Analytics"
4. Select **Google Analytics (GA4)** connector
5. Choose your property: **qr-code-generator (G-ESSRNC6XGC)**
6. Click **Add** → **Add to Report**

### Step 2: Configure Date Range Control
1. Add a **Date Range Control** at the top
2. Set default to "Last 7 days"

Now you're ready to add visualizations!

---

## 🎨 Looker Studio Interface Guide

**Adding Charts:**
- **Toolbar method:** Click **Add a chart** button in the toolbar (looks like a bar chart icon)
- **Menu method:** Go to **Insert** → **Chart** → Select chart type
- **Chart types you'll use:**
  - **Scorecard** (also called "Number" or "Single value") - Shows one big number
  - **Table** - Shows data in rows/columns
  - **Bar chart** - Horizontal or vertical bars
  - **Pie chart** - Circle divided into slices
  - **Line chart** (Time series) - Shows trends over time
  - **Area chart** - Like line chart but filled
  - **Funnel chart** - Under "Other charts"

**Configuring Charts:**
- After adding a chart, the **properties panel** appears on the right
- **Data tab:** Set dimensions, metrics, and filters
- **Style tab:** Change colors, fonts, and appearance
- **Setup tab:** Funnel steps and special configurations

**Pro Tip:** Right-click any chart → **Duplicate** to quickly create similar charts!

**Can't find a chart type?**
- Look in **Insert** → **Chart** → Scroll through all options
- Scorecard might be under **"Scorecard"**, **"Number"**, or **"Single value"**
- Still can't find it? Use a **Table** with 1 row instead - same result!

---

## 📊 Dashboard Layout & Visualizations

### **Section 1: Overview Metrics (Scorecards at Top)**

Add 5 **Scorecard** widgets in a row:

> **💡 How to add a Scorecard (Step-by-Step):**
> 1. Click the **"Add a chart"** button in the toolbar (top of screen)
> 2. A menu will appear showing all chart types
> 3. Look for **"Scorecard"** (it's usually in the first row or two)
>    - **Alternative names:** "Number", "Scorecard", or look for a chart icon with "123" or single number
>    - If you see a grid of chart icons, **Scorecard looks like a single large number/metric**
> 4. Click on "Scorecard" - your cursor will change to a crosshair
> 5. Click and drag on the canvas to place the scorecard
> 6. The scorecard appears + properties panel opens on the right
> 7. Now configure it (see instructions below)

**Alternative if you can't find Scorecard:**
Use **Insert** menu → **Chart** → Look through all chart types, or use a 1-row **Table** as a substitute

**Scorecard 1: Total QR Codes Generated**
- Metric: `Event count`
- Filter: `Event name` = `qr_generated`
- Add comparison: Previous period (optional)

**Scorecard 2: Total Downloads**
- Metric: `Event count`
- Filter: `Event name` CONTAINS `download_`
- Or use: `Event name` STARTS WITH `download_`

**Scorecard 3: Bucket Adds**
- Metric: `Event count`
- Filter: `Event name` = `bucket_qr_added`

**Scorecard 4: AI Images Created**
- Metric: `Event count`
- Filter: `Event name` = `artistic_ai_success`

**Scorecard 5: Template Selections**
- Metric: `Event count`
- Filter: `Event name` = `input_template_selected`

**Quick Tip:** After adding the first scorecard, duplicate it 4 times (right-click → Duplicate), then just change the filter for each one!

---

### **Section 2: User Journey Funnel**

Add a **Funnel Chart**:

**Configuration:**
- Chart type: Funnel
- Steps (in order):
  1. `input_template_selected` → "Template Selected"
  2. `qr_generated` → "QR Generated"
  3. `bucket_qr_added` → "Added to Bucket"
  4. Event name starts with `download_` → "Downloaded"

This shows your conversion rate from initial interest to download.

---

### **Section 3: Feature Usage Breakdown**

#### **A. INPUT Features** (Bar Chart)
- Dimension: `Event name`
- Metric: `Event count`
- Filter: Event name IN (`input_template_selected`, `input_label_added`)
- Sort: Descending by Event count

#### **B. Template Popularity** (Pie Chart)
- Dimension: `template` (custom parameter)
- Metric: `Event count`
- Filter: Event name = `input_template_selected`
- Show top 10 templates

---

### **Section 4: Customization Features** (Grouped Bar Charts)

#### **A. Logo Usage**
- Dimension: `Event name`
- Metric: `Event count`
- Filter: Event name IN (`logo_selected`, `logo_removed`)

#### **B. Artistic Features** (Stacked Bar)
- Dimension: `Event name`
- Metric: `Event count`
- Filter: Event name starts with `artistic_`
- Values:
  - `artistic_background_uploaded`
  - `artistic_background_cleared`
  - `artistic_ai_requested`
  - `artistic_ai_success`
  - `artistic_blend_mode_changed`
  - `artistic_opacity_adjusted`
  - `artistic_qr_strength_adjusted`

**Pro Tip:** Add a calculated field for AI Success Rate:
```
AI Success Rate = (artistic_ai_success / artistic_ai_requested) * 100
```

#### **C. Color Customization** (Bar Chart)
- Dimension: `Event name`
- Metric: `Event count`
- Filter: Event name starts with `colors_`
- Breakdown dimension: `method` (shows picker vs text_input usage)

#### **D. Style Patterns** (Pie Chart)
- Dimension: `pattern` (custom parameter)
- Metric: `Event count`
- Filter: Event name = `style_pattern_selected`

---

### **Section 5: Size Adjustments** (Line Chart Over Time)

- Chart type: Time series (line)
- Dimension: `Date`
- Metrics (4 lines):
  - `size_qr_adjusted` count
  - `size_border_adjusted` count
  - `size_logo_adjusted` count
  - `size_label_adjusted` count
- Date range: Last 30 days

This shows which size controls users interact with most.

---

### **Section 6: History/Undo Usage** (Scorecard + Bar)

#### **Scorecards (Row):**
1. **Undo Clicks:** Event count where Event name = `history_undo_clicked`
2. **Redo Clicks:** Event count where Event name = `history_redo_clicked`
3. **Keyboard Shortcuts:** Event count where Event name IN (`history_keyboard_undo`, `history_keyboard_redo`)
4. **Dropdown Usage:** Event count where Event name = `history_dropdown_opened`
5. **History Jumps:** Event count where Event name = `history_jump_selected`

#### **Keyboard vs Click Usage (Comparison)**
- Dimension: Calculated field:
  ```
  CASE
    WHEN Event name IN ('history_keyboard_undo', 'history_keyboard_redo') THEN 'Keyboard'
    WHEN Event name IN ('history_undo_clicked', 'history_redo_clicked') THEN 'Click'
  END
  ```
- Metric: Event count

---

### **Section 7: Bucket Operations** (Area Chart)

- Chart type: Area chart
- Dimension: `Date` (hourly or daily)
- Metrics (stacked):
  - `bucket_qr_added` count
  - `bucket_qr_removed` count
  - `bucket_cleared` count
  - `bucket_limit_reached` count

Shows bucket engagement patterns over time.

---

### **Section 8: Download Analysis** (Table + Charts)

#### **A. Download Format Breakdown** (Pivot Table)

| Format | Single | Batch | Total |
|--------|--------|-------|-------|
| PNG | `download_single_png` | `download_batch_png` | SUM |
| SVG | `download_single_svg` | `download_batch_svg` | SUM |
| JPG | `download_single_jpg` | `download_batch_jpg` | SUM |
| PDF | `download_single_pdf` | `download_batch_pdf` | SUM |
| Metadata PDF | - | `download_metadata_pdf` | - |
| Printable PDF | - | `download_printable_pdf` | - |

**Configuration:**
- Rows: Extract format from Event name (calculated field)
- Columns: Extract type (single/batch)
- Values: Event count

#### **B. Download Volume Over Time** (Line Chart)
- Dimension: `Date`
- Metric: Event count
- Filter: Event name starts with `download_`
- Breakdown: Format (PNG/SVG/JPG/PDF)

#### **C. Label Usage in Downloads** (Pie Chart)
- Dimension: `has_label` parameter
- Metric: Event count
- Filter: Event name starts with `download_single_`

Shows what percentage of single downloads include labels.

---

### **Section 9: QR Code Characteristics** (Scorecards + Tables)

#### **Scorecards:**
1. **With Logo:** Event count where `has_logo` = 'true' (from `bucket_qr_added`)
2. **With Label:** Event count where `has_label` = 'true'
3. **With Artistic:** Event count where `has_artistic` = 'true'

#### **Table: Popular Combinations**
- Dimensions: `has_logo`, `has_label`, `has_artistic`, `style`
- Metric: Event count
- Filter: Event name = `bucket_qr_added`
- Sort: Descending by count

Shows which feature combinations are most popular.

---

### **Section 10: Error Correction & Quality**

#### **A. Error Correction Levels** (Pie Chart)
- Dimension: `level` parameter
- Metric: Event count
- Filter: Event name = `error_correction_level_changed`

#### **B. Size Optimization Actions** (Scorecard)
- Metric: Event count
- Filter: Event name = `size_optimized` AND `source` = 'quality_score_recommendation'

Shows how often users accept size recommendations from quality score.

---

## 🎯 Advanced Configurations

### **Custom Calculated Fields**

Add these in Looker Studio for deeper insights:

#### 1. **Feature Adoption Rate**
```
(COUNT(DISTINCT User pseudo ID where artistic_background_uploaded) / COUNT(DISTINCT User pseudo ID where qr_generated)) * 100
```

#### 2. **Download Conversion Rate**
```
(COUNT(Event where Event name starts with download_) / COUNT(Event where Event name = qr_generated)) * 100
```

#### 3. **AI Generation Success Rate**
```
(COUNT(artistic_ai_success) / COUNT(artistic_ai_requested)) * 100
```

#### 4. **Bucket Usage Rate**
```
(COUNT(bucket_qr_added) / COUNT(qr_generated)) * 100
```

#### 5. **Keyboard Shortcut Adoption**
```
(COUNT(history_keyboard_*) / COUNT(history_undo_clicked + history_redo_clicked)) * 100
```

---

## 📧 Schedule Email Reports

Once your dashboard is built:

1. Click **Share** → **Schedule delivery**
2. Configure:
   - **Recipients:** Your email
   - **Frequency:** Daily at 7:00 AM
   - **Format:** PDF (for easy viewing)
   - **Date range:** Yesterday (for daily stats)
3. Click **Schedule**

You'll receive a daily PDF with all metrics!

---

## 🔍 GA4 Real-Time Monitoring

To watch events live as users interact:

1. Open [GA4 Real-Time Report](https://analytics.google.com/analytics/web/#/p<YOUR_PROPERTY_ID>/realtime/overview)
2. Click **Event name** dimension
3. Watch events like `artistic_ai_requested`, `download_single_png`, etc. appear in real-time
4. Click any event to see its parameters (template, method, value, etc.)

---

## 📱 Mobile Dashboard (Looker Studio App)

1. Download **Looker Studio** app (iOS/Android)
2. Sign in with your Google account
3. Access your dashboard on-the-go
4. Get push notifications for scheduled reports

---

## 🎨 Dashboard Design Tips

### Color Coding Sections
- **INPUT:** Blue (#4285F4)
- **CUSTOMIZATION (Logo/Artistic/Colors/Style):** Green (#34A853)
- **SIZE/HISTORY:** Yellow (#FBBC05)
- **BUCKET/DOWNLOAD:** Red (#EA4335)

### Widget Sizing
- **Overview Scorecards:** 1/5 width each (5 across)
- **Feature Charts:** 1/2 width (2 across)
- **Tables:** Full width
- **Time Series:** Full width

### Annotations
Add text boxes between sections explaining:
- "This shows how users discover features..."
- "Peak download times help plan server capacity..."
- "High AI request but low success = API issues"

---

## 🚨 Alerts to Set Up

In GA4, create custom alerts:

1. **Anomaly Alerts:**
   - Go to Configure → Automated insights
   - Enable email notifications
   - GA4 will alert you to unusual spikes/drops

2. **Custom Alerts:**
   - Go to Configure → Custom definitions → Custom alerts
   - Examples:
     - `artistic_ai_requested` > 100/day (high API usage)
     - `bucket_limit_reached` > 50/day (consider increasing limit)
     - Download rate < 10% (UX issue?)

---

## 📊 Sample Insights You'll Discover

With this dashboard, you'll answer questions like:

- **Which template is most popular?** → Focus marketing there
- **Do users prefer PNG or PDF downloads?** → Optimize that format
- **What's the AI image success rate?** → Monitor API reliability
- **How many users use keyboard shortcuts?** → Power user indicator
- **Which color presets get used?** → Remove unpopular ones
- **Do artistic QR codes get downloaded more?** → Feature promotion
- **What time of day has peak usage?** → Server scaling

---

## 🔗 Quick Links

- **Your GA4 Property:** https://analytics.google.com/analytics/web/#/p<YOUR_PROPERTY_ID>/
- **Looker Studio:** https://lookerstudio.google.com
- **GA4 Documentation:** https://support.google.com/analytics/answer/9304153

---

## 💡 Pro Tips

1. **Create Multiple Dashboards:**
   - Executive Summary (high-level metrics)
   - Feature Deep-Dive (detailed usage)
   - Technical Monitoring (errors, API calls)

2. **Share with Team:**
   - Share → Add people → View access
   - Embed in internal tools

3. **Compare Time Periods:**
   - Add "Comparison date range" control
   - Compare week-over-week, month-over-month

4. **Export Data:**
   - Download as CSV for offline analysis
   - Connect to BigQuery for advanced SQL

---

## 🎯 Next Steps

1. ✅ Create basic Looker Studio report (10 min)
2. ✅ Add Overview + Feature Usage sections (15 min)
3. ✅ Add Download Analytics (10 min)
4. ✅ Schedule daily email delivery
5. ✅ Test for 1 week, refine based on insights
6. ✅ Share with stakeholders

---

**Need Help?** The hierarchical event naming makes filtering super easy:
- `artistic_*` = All artistic features
- `download_*` = All downloads
- `bucket_*` = All bucket operations
- `colors_*` = All color changes

Happy analyzing! 📈
