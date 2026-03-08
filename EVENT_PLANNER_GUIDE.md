# 🎉 QR Code Templates for Event Planners

**For: Carlie**  
**From: Dad**

This guide shows you which QR code templates are perfect for event planning, with real-world examples you can use immediately!

---

## 🎯 Best Templates for Events (Ranked by Usefulness)

### **1. 📅 Event Template** ⭐⭐⭐⭐⭐
**Most Important for Event Planners!**

**What it does:** Creates a calendar event that guests can instantly add to their phone calendar

**Format:**
```
BEGIN:VEVENT
SUMMARY:Event Title
DTSTART:20250115T100000Z
DTEND:20250115T110000Z
LOCATION:Event Location
DESCRIPTION:Event description here
END:VEVENT
```

**Real-World Use Cases:**

🎪 **Wedding Invitations**
```
SUMMARY:Sarah & Mike's Wedding
DTSTART:20260815T160000Z
DTEND:20260815T230000Z
LOCATION:The Grand Ballroom, 123 Main St, City
DESCRIPTION:Join us for our special day! Cocktail hour at 4pm, ceremony at 5pm, reception to follow. Formal attire.
```
- Print QR code on invitations → Guests scan → Event auto-adds to calendar
- No more "I forgot the date!"

🎂 **Birthday Parties**
```
SUMMARY:Emma's 5th Birthday Party
DTSTART:20260320T140000Z
DTEND:20260320T170000Z
LOCATION:Adventure Playground, 456 Park Ave
DESCRIPTION:Pizza, cake, and fun! RSVP by March 10 to mom@email.com
```
- Put QR on evites, flyers, or social media posts
- Parents scan and add to their busy calendars instantly

🏢 **Corporate Events**
```
SUMMARY:Annual Company Gala
DTSTART:20261210T180000Z
DTEND:20261210T230000Z
LOCATION:Downtown Convention Center, Hall A
DESCRIPTION:Black tie event. Dinner at 7pm, awards at 8pm, dancing at 9pm. Valet parking available.
```
- Email invites with QR code
- Print on badges or signage
- Include in digital event programs

🎭 **Conferences & Trade Shows**
```
SUMMARY:Tech Conference 2026 - Keynote
DTSTART:20260615T090000Z
DTEND:20260615T103000Z
LOCATION:Convention Center - Main Stage
DESCRIPTION:Keynote: "Future of AI" with Dr. Jane Smith. Coffee service at 8:30am.
```
- Multiple QR codes for different sessions
- Attendees build their schedule by scanning sessions they want to attend
- Put QR codes on booth displays, programs, or badges

🎵 **Concerts & Shows**
```
SUMMARY:Summer Music Festival - Day 1
DTSTART:20260705T150000Z
DTEND:20260705T230000Z
LOCATION:City Park Amphitheater
DESCRIPTION:Gates open 2pm. Headliner at 8pm. Bring lawn chairs. No outside food/beverage.
```

📱 **Pro Tip:** Use the bucket feature to create QR codes for every session at a multi-day conference, then batch download as PDF!

---

### **2. 📍 Location/Map Template (geo:)** ⭐⭐⭐⭐⭐
**Essential for Event Venues!**

**What it does:** Opens maps app with exact GPS coordinates + altitude

**Format:**
```
geo:37.7749,-122.4194,100
```
(latitude, longitude, altitude in meters)

**Real-World Use Cases:**

🏛️ **Wedding Venues**
```
geo:40.7589,-73.9851,0
```
- Put on "Directions" card in invitation suite
- Scan → Opens Google Maps/Apple Maps → Start Navigation
- Especially useful for outdoor/remote venues

🎪 **Festival Entrances**
```
geo:34.0522,-118.2437,0
Label: "VIP Entrance"
```
- Print multiple QR codes for different entrances (VIP, General, Staff)
- Put on wristbands, tickets, or signage
- Guests scan and navigate directly to the right gate

🏨 **Multi-Building Events**
```
geo:37.7749,-122.4194,0
Label: "Cocktail Hour - West Garden"
```
- Print on program or signage
- Helps guests navigate large venues or campus-style locations

🚗 **Parking Areas**
```
geo:40.7589,-73.9851,0
Label: "Guest Parking Lot"
```
- Include on invitations
- Scan for turn-by-turn directions to parking

📌 **How to Get Coordinates:**
1. Open Google Maps
2. Right-click on the venue location
3. First two numbers = coordinates to use

---

### **3. 🔗 URL/Website Template** ⭐⭐⭐⭐⭐
**Your Swiss Army Knife!**

**What it does:** Opens any website

**Format:**
```
https://yourwebsite.com
```

**Real-World Use Cases:**

💍 **Wedding Websites**
```
https://sarahandmike.wedding
Label: "Visit our wedding website"
```
- Print on save-the-dates, invitations
- Links to RSVP form, registry, hotel info, schedule
- Update info anytime without reprinting QR codes!

🎟️ **Event Registration**
```
https://eventbrite.com/your-event
Label: "Register Now"
```
- Print on flyers, posters, business cards
- Instant registration instead of typing URLs

📸 **Photo Galleries**
```
https://photos.google.com/share/yourevent
Label: "View Event Photos"
```
- Put on thank-you cards after event
- Share at photo booths during event
- Guests scan to see all photos from your event

🎁 **Gift Registries**
```
https://registry.theknot.com/sarah-mike
Label: "Our Registry"
```

📋 **Event Feedback Forms**
```
https://forms.gle/your-feedback-form
Label: "Share Your Feedback"
```
- Print on table cards at end of event
- Include in thank-you emails

💰 **Payment/Tips**
```
https://venmo.com/yourname
Label: "Venmo Tips Appreciated"
```
- For catering staff, bartenders, entertainers
- Put near tip jars

---

### **4. 📱 SMS Template** ⭐⭐⭐⭐
**Great for Quick Updates!**

**What it does:** Opens text message app with pre-filled message

**Format:**
```
sms:+1234567890?body=Your message here
```

**Real-World Use Cases:**

🔔 **Event Reminders**
```
sms:+15551234567?body=Hi! I'd like to RSVP for [Event Name]
Label: "Text to RSVP"
```
- Put on invitations or social media
- Easier than phone calls or emails
- You get RSVPs as text messages

🚨 **Day-of Coordinators**
```
sms:+15551234567?body=I need assistance at [Event Name]
Label: "Text for Help"
```
- Print on signage throughout venue
- Guests can quickly request help
- You see exactly where help is needed

📞 **Vendor Communication**
```
sms:+15551234567?body=Checking status of [Vendor Service]
Label: "Text Caterer"
```
- Share with clients for vendor contact
- Pre-fills professional message

---

### **5. 📧 Email Template** ⭐⭐⭐⭐
**Professional Communication**

**What it does:** Opens email app with pre-filled recipient

**Format:**
```
mailto:your@email.com?subject=Event Inquiry&body=Hello, I'm interested in...
```

**Real-World Use Cases:**

💼 **Event Inquiry**
```
mailto:carlie@events.com?subject=Event Inquiry&body=Hi Carlie! I'm interested in planning an event.
Label: "Email for Quote"
```
- Put on business cards
- Include on website/social media
- Makes it easy for clients to reach you

📝 **Vendor Coordinator Email**
```
mailto:carlie@events.com?subject=Vendor Check-in for [Event Name]
Label: "Email Coordinator"
```
- Share with vendors for event day
- Pre-fills subject line so emails are organized

---

### **6. 📞 Phone Template** ⭐⭐⭐
**Emergency Contacts**

**What it does:** Starts phone call instantly

**Format:**
```
tel:+1234567890
```

**Real-World Use Cases:**

🚨 **Event Day Emergency**
```
tel:+15551234567
Label: "Call Event Coordinator"
```
- Print on all signage, programs, badges
- One tap = call you directly

🏨 **Venue Contact**
```
tel:+15551234567
Label: "Call Venue Manager"
```
- Share with guests for day-of questions

---

### **7. 📶 WiFi Template** ⭐⭐⭐⭐⭐
**Guest Favorite!**

**What it does:** Auto-connects to WiFi (no password typing!)

**Format:**
```
WIFI:T:WPA;S:NetworkName;P:Password;;
```

**Real-World Use Cases:**

🎪 **Wedding Receptions**
```
WIFI:T:WPA;S:VenueGuest;P:Welcome2026;;
Label: "Guest WiFi"
```
- Print on table cards at each table
- Scan = instant connection (no typing!)
- Guests can post photos live

🏢 **Corporate Events**
```
WIFI:T:WPA;S:ConferenceWiFi;P:TechConf2026;;
Label: "Conference WiFi"
```
- Print on badges, programs, signage
- No IT support needed for password sharing

🎭 **Trade Show Booths**
```
WIFI:T:WPA;S:BoothDemo;P:DemoPass123;;
Label: "Demo WiFi"
```
- Let attendees connect for live demos

---

### **8. 👤 vCard/MECARD Templates** ⭐⭐⭐
**Professional Networking**

**What it does:** Saves contact instantly to phone

**Format (vCard):**
```
BEGIN:VCARD
VERSION:3.0
FN:Carlie [Last Name]
TEL:+1234567890
EMAIL:carlie@events.com
ORG:Carlie's Event Planning
TITLE:Event Coordinator
END:VCARD
```

**Real-World Use Cases:**

🎯 **Your Business Card**
- Print QR on physical business cards
- Scan = instant contact save
- No more manual entry or lost cards

🤝 **Networking at Events**
- Include on name badge
- Quick contact exchange at conferences

👥 **Vendor Contacts**
- Create vCard for each vendor (caterer, DJ, florist)
- Share with clients as QR codes
- Clients scan to save all vendor contacts

---

## 🎯 Real Event Examples - Full Setup

### **Example 1: Wedding Invitation Suite**

**Save the Date Card:**
- QR Code 1: Event template (ceremony date/time)
- QR Code 2: URL (wedding website)

**Formal Invitation:**
- QR Code 1: Event template (full schedule)
- QR Code 2: URL (RSVP page)
- QR Code 3: geo: (venue location)

**Details Card:**
- QR Code 1: WiFi (venue guest network)
- QR Code 2: URL (photo sharing link)
- QR Code 3: geo: (hotel block location)

**Table Cards at Reception:**
- WiFi QR code on every table

---

### **Example 2: Corporate Conference**

**Registration Email:**
- QR Code: URL (ticket page)

**Conference Program (Printed):**
- QR Code on each session listing = Event template (adds session to calendar)
- QR Code on venue map = geo: (session room locations)
- QR Code on back page = WiFi (conference network)

**Name Badge:**
- QR Code: vCard (attendee's contact)

**Sponsor Booth:**
- QR Code: URL (sponsor website)
- QR Code: vCard (booth rep contact)
- QR Code: Email (mailto: for product inquiry)

---

### **Example 3: Birthday Party**

**Digital Invitation (Email/Facebook):**
- QR Code 1: Event template (party date/time/location)
- QR Code 2: SMS (text to RSVP)

**Paper Invitation:**
- Same 2 QR codes

**Party Venue Signage:**
- QR Code 1: WiFi (so parents can work while kids play)
- QR Code 2: URL (photo sharing link)
- QR Code 3: Phone (call coordinator for help)

---

## 💡 Pro Tips for Event Planners

### **Design Tips:**
1. **Use Artistic QR Mode** for decorative invitations
   - Upload event colors/patterns as background
   - Match invitation theme

2. **Add Logo** to branded QR codes
   - Company logo for corporate events
   - Couple's monogram for weddings
   - Birthday person's photo

3. **Use Labels** for clarity
   - "Scan to Add to Calendar"
   - "Scan for WiFi"
   - "Scan for Directions"

4. **Color Coordination**
   - Match QR colors to event theme
   - Use preset colors or custom colors

### **Printing Tips:**
1. **Minimum Size:** 1 inch × 1 inch for reliable scanning
2. **Test Before Mass Printing:** Always test QR codes with multiple phones
3. **High Error Correction:** Use "High (H)" setting if adding logos/backgrounds
4. **Print Quality:** 300 DPI minimum for printed materials

### **Organizational Tips:**
1. **Use the Bucket Feature:**
   - Create all event QR codes in one session
   - Add each to bucket with notes
   - Batch download as PDF or ZIP
   - Keep organized by event

2. **Use Notes Field:**
   - "Table card WiFi"
   - "Invitation - Save the Date"
   - "Vendor contact - Caterer"

3. **Metadata PDFs:**
   - Download metadata PDF for your records
   - Shows all QR contents + settings
   - Reference for future events

---

## 🚀 Quick Reference: Which Template When?

| Need | Template | Example |
|------|----------|---------|
| Add event to calendar | Event | "Add wedding to calendar" |
| Get directions | geo: | "Navigate to venue" |
| Share website | URL | "Visit wedding website" |
| Collect RSVPs | SMS or URL | "Text to RSVP" or link to form |
| Share WiFi | WiFi | "Connect to guest network" |
| Emergency contact | Phone | "Call coordinator" |
| Exchange contacts | vCard | "Save vendor contact" |
| Send inquiry | Email | "Email for quote" |
| Photo sharing | URL | "View event photos" |
| Payment/tips | URL | Link to Venmo/Zelle |

---

## 📦 Workflow for Multi-Event Planner

**Your Typical Event Setup (Step-by-Step):**

1. **Create Event Calendar QR** (Event template)
   - Add to bucket
   - Note: "Main event date"

2. **Create Venue Location QR** (geo:)
   - Add to bucket
   - Note: "Venue GPS"

3. **Create Website QR** (URL)
   - Add to bucket
   - Note: "Event website"

4. **Create WiFi QR** (WiFi template)
   - Add to bucket
   - Note: "Guest WiFi"

5. **Create Contact QR** (Phone or vCard)
   - Add to bucket
   - Note: "Coordinator contact"

6. **Batch Download:**
   - Download as Printable PDF
   - Each QR labeled with notes
   - Print and cut for use

7. **Save for Records:**
   - Download Metadata PDF
   - File with other event documents

---

## 🎯 Bottom Line for Event Planners

**Top 5 Templates You'll Use Most:**
1. ⭐ **Event** - Calendar invites (use on EVERY invitation)
2. ⭐ **geo:** - Venue directions (use on EVERY invitation)
3. ⭐ **URL** - Websites, forms, registries (use constantly)
4. ⭐ **WiFi** - Guest network (use at EVERY venue)
5. ⭐ **SMS** - Quick RSVPs (optional but super helpful)

**Start Simple:**
- Begin with just Event + geo: + URL on invitations
- Add WiFi QR codes at venues
- Expand from there as you get comfortable

**Time Savings:**
- Create QR template library for common events
- Reuse WiFi QR codes for same venues
- Batch create for multi-day events

---

## 💌 Final Note

Carlie - these QR codes will make your events more professional and your job easier. Guests love the convenience, and you'll spend less time answering "What's the WiFi?" or "How do I get there?"

Start experimenting with your next event! The artistic QR mode can make them beautiful enough to be part of your design aesthetic.

Love,  
Dad 

P.S. - If you need help setting up QR codes for a specific event, just ask! I can walk you through it.

---

**Questions? Visit:** https://fitzgr.github.io/qr-code-generator/
