// src/data/categoryKeywords.js
//
// Category id/label/keyword data, deliberately with NO image imports.
// categories.js (the browser-facing version, with `image` attached) and
// productCache.js both need this list, but productCache.js is also
// imported directly by plain-`node` scripts (generate-reports.js,
// discover-off-products.js) that run outside Vite -- Vite is what turns
// a `.png` import into a usable module, and plain Node's ESM loader
// throws ERR_UNKNOWN_FILE_EXTENSION the moment it meets one. Keeping
// the images only in categories.js keeps this file safe to import from
// either place.
// `labelHi` is a plain data field, not routed through src/i18n/strings.js
// -- this file (unlike strings.js) is also imported by plain-Node
// scripts with no LanguageContext in the loop, so each category just
// carries its own translation alongside its keywords. Callers with a
// LanguageProvider (Home.jsx/Category.jsx) pick label vs labelHi off
// the current language.
// Indian mithai. Browsed under "Chocolates & Sweets", and kept OUT of every
// other category: "Desi Ghee Motichoor Laddu" names ghee but isn't dairy.
export const INDIAN_SWEET_KEYWORDS = ['laddu', 'ladoo', 'laddoo', 'motichoor', 'barfi', 'burfi', 'peda', 'pedha', 'halwa', 'soan papdi', 'son papdi', 'kaju katli', 'rasgulla', 'gulab jamun', 'rasmalai', 'jalebi', 'mysore pak'];

export const CATEGORY_KEYWORDS = [
  { id: 'biscuits', label: 'Biscuits & Cookies', labelHi: 'बिस्कुट और कुकीज़', keywords: ['biscuit', 'cookie', 'cracker', 'rusk'] },
  // 'instant' on its own used to be a keyword here too, but it's generic
  // enough to also match things like "Bru Instant Coffee" -- which then
  // surfaced as a "safer alternative" to a pasta product. Every keyword
  // left here is specific to an actual noodle/pasta product.
  { id: 'noodles', label: 'Instant Noodles', labelHi: 'इंस्टेंट नूडल्स', keywords: ['noodle', 'maggi', 'pasta', 'vermicelli', 'macaroni', 'soup'] },
  { id: 'beverages', label: 'Beverages', labelHi: 'ड्रिंक्स', keywords: ['juice', 'drink', 'squash', 'tea', 'coffee'] },
  { id: 'snacks', label: 'Snacks & Namkeen', labelHi: 'स्नैक्स और नमकीन', keywords: ['chips', 'namkeen', 'bhujia', 'sev', 'mixture', 'popcorn', 'wafer'] },
  { id: 'chocolates', label: 'Chocolates & Sweets', labelHi: 'चॉकलेट और मीठा', keywords: ['chocolate', 'candy', 'toffee', 'eclair', 'chikki', ...INDIAN_SWEET_KEYWORDS] },
  { id: 'spices', label: 'Spices & Masala', labelHi: 'मसाले', keywords: ['masala', 'spice', 'haldi', 'mirchi', 'garam'] },
  { id: 'dairy', label: 'Dairy & Frozen', labelHi: 'डेयरी और फ़्रोज़न', keywords: ['milk', 'cheese', 'paneer', 'curd', 'dahi', 'ice cream', 'kulfi', 'ghee', 'butter'] },
  { id: 'essentials', label: 'Cooking Essentials', labelHi: 'रोज़मर्रा की ज़रूरतें', keywords: ['oil', 'atta', 'flour', 'rice', 'sauce', 'ketchup'] },
];
