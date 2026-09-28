// src/data/privacyPolicy.js
//
// The privacy policy shown at /privacy (Settings > Privacy Policy) -- also
// the public URL to give the Play Store. Written from what the code
// actually does (checked 2026-09-28): what stays on the device, what goes
// to which service and why. If a feature starts sending or storing
// something new, this has to change with it.
//
// Plain data so the page can render either language. The English text is
// the one that applies if the two ever differ.

export const PRIVACY_POLICY_UPDATED = '2026-09-28';

// Shown as the contact for privacy questions -- left empty until the owner
// chooses which address to publish (the section then points to the app's
// own "Report an issue" instead).
export const PRIVACY_CONTACT_EMAIL = '';

export const PRIVACY_POLICY = {
  en: {
    title: 'Privacy Policy',
    updated: 'Last updated: 28 September 2026',
    intro: 'FoodGuard India helps you understand what is in packaged food. This policy explains what information the app uses, where it goes, and what stays only on your phone. In short: there is no account, we do not ask for your name, phone number or email, we do not track your location, and there are no ads or tracking tools in the app.',
    contactFallback: 'For any privacy question or request, use "Report an issue with this result" on any product in the app and write your question in the note, or reach the developer through the app’s Play Store listing.',
    contactPrefix: 'For any privacy question or request, write to',
    languageNote: '',
    sections: [
      {
        h: 'Summary',
        list: [
          'No sign-up or login for app users. We do not collect your name, phone number, email address or location.',
          'Your scan history, family profiles (including allergies), intake log and settings are stored only on your device.',
          'Photos you take of a label or pack are sent to Google’s Gemini service to read the text, and are not stored by FoodGuard.',
          'When you analyse a product that is new to FoodGuard, its product name, ingredients and result are added to FoodGuard’s shared product catalog so others can find it. No information about you is attached to it.',
          'No ads, no analytics, no tracking across other apps or websites. We do not sell data.',
        ],
      },
      {
        h: '1. Who we are',
        p: ['FoodGuard India ("FoodGuard", "we") is an independent app that scores packaged food by its ingredients and nutrition, checked against FSSAI (India) and EU/EFSA standards. It is not affiliated with FSSAI or any government body.'],
      },
      {
        h: '2. Information stored only on your device',
        p: ['These are kept in your phone’s app storage (or the browser, on the website) and are never sent to FoodGuard’s servers:'],
        list: [
          'Scan history — the products you have checked and their results.',
          'Family profiles — the nicknames you choose, food priorities, and allergies you select. Personal scores are worked out on your device.',
          'My Intake — what you log eating and its nutrition.',
          'Preferences — language, theme, shopping mode and notification settings.',
          'A random device identifier — created on your device and not linked to you. It is only sent when you confirm a barcode match (see section 3), so that several separate confirmations can be counted.',
        ],
        after: ['You can remove this data by using "Clear all" in History, deleting family profiles, clearing the app’s storage in your phone settings, or uninstalling the app. "Export backup" in Settings creates a file on your device that only you control.'],
      },
      {
        h: '3. Information sent when you use a feature',
        p: ['Some features only work by sending information to FoodGuard’s database or to a service provider. This happens only when you use that feature:'],
        list: [
          'Scanning a barcode or searching: the barcode number or search words are looked up in FoodGuard’s database and in Open Food Facts, a free public food database.',
          'Photo of a label or the front of a pack: the photo is sent to Google’s Gemini API so the ingredients, nutrition table or product name can be read from it. FoodGuard does not store these photos.',
          'Analysing ingredients: the ingredient text and product name are sent to Google’s Gemini API to research ingredients and write the explanation, and the resulting text is sent to Cloudflare Workers AI to translate it into Hindi.',
          'New products: when a product is analysed for the first time, its product name, ingredients text, result and (for barcode scans) barcode are saved in FoodGuard’s shared product catalog, so the next person gets the result instantly. A new product is shown to others only after FoodGuard’s team reviews it. Nothing about who scanned it is stored — please do not type personal information into product name or note fields.',
          'Report an issue and name suggestions: the reason you choose, any note you write, the name you suggest, and a copy of the result as you saw it.',
          'Submit a product: the photos you take (front, ingredients, nutrition), the barcode, and any name or note you add.',
          'Barcode match: when a scanned barcode isn’t known and you tap the matching product, the barcode, the product and the random device identifier are saved so FoodGuard’s team can link them.',
          'Sharing: when you choose to share a result, the share text and a link to that product’s report are passed to the app you pick (for example WhatsApp).',
        ],
        after: ['FoodGuard uses Google’s free Gemini API. Under Google’s terms for free use, Google may use the content sent to it (such as label photos and ingredient text) to improve its services. Please photograph only the product pack — not people, documents or anything personal.'],
      },
      {
        h: '4. Permissions the app asks for',
        list: [
          'Camera — to scan barcodes and take photos of labels or packs. Used only while you are scanning or taking a photo.',
          'Photos / files — only the single image you choose to pick from your gallery.',
          'Notifications (Android) — optional reminders, created on your device. You can turn them off in Settings. To deliver them on time and keep them after a restart, the app also has the standard Android permissions to schedule alarms and run at start-up.',
          'Internet and vibration — to reach the services above, and a short vibration when a result appears.',
        ],
        after: ['The app does not ask for location, contacts, microphone or phone permissions.'],
      },
      {
        h: '5. Service providers',
        p: ['FoodGuard uses these providers to run the features above. Each handles data under its own privacy terms, and may record technical details such as your IP address while serving a request:'],
        list: [
          'Supabase — FoodGuard’s database and photo storage.',
          'Google (Gemini API) — reading photos and researching ingredients.',
          'Cloudflare (Workers AI) — Hindi translation of results.',
          'Open Food Facts — the public food database used for barcode lookups.',
          'GitHub Pages — hosts the FoodGuard website.',
        ],
      },
      {
        h: '6. What we do not do',
        list: [
          'We do not sell, rent or trade any data.',
          'We do not show ads or use advertising IDs.',
          'We do not use analytics or tracking tools, and do not follow you across other apps or websites.',
          'We do not collect your location.',
          'We do not build a profile of you. Scores are about products, not people.',
        ],
      },
      {
        h: '7. How long information is kept',
        list: [
          'On your device: until you delete it or uninstall the app.',
          'Shared product catalog: products stay in the catalog so others can use them; they carry no information about you.',
          'Reports, suggestions, submitted photos and barcode matches: kept while they are reviewed and afterwards as a record of what changed. You can ask for something you submitted to be removed.',
        ],
      },
      {
        h: '8. Your choices',
        p: ['You can use FoodGuard without giving any personal information. You can delete everything stored on your device at any time. If you want a report, photo or suggestion you sent to be removed, contact us (section 12) with the product and roughly when you sent it. FoodGuard aims to follow India’s Digital Personal Data Protection Act, 2023, by collecting as little as possible.'],
      },
      {
        h: '9. Children',
        p: ['FoodGuard is a general-audience app. It has no accounts and does not knowingly collect personal information from anyone, including children. Family profiles for children are stored only on the parent’s device.'],
      },
      {
        h: '10. Not medical advice',
        p: ['Scores and explanations are general information about products, not medical advice. For personal dietary or health decisions, consult a qualified healthcare professional.'],
      },
      {
        h: '11. Changes to this policy',
        p: ['If the app starts using information differently, this policy will be updated and the date at the top will change. Important changes will be mentioned in the app.'],
      },
      {
        h: '12. Contact',
        contact: true,
      },
    ],
  },
  hi: {
    title: 'प्राइवेसी पॉलिसी',
    updated: 'आख़िरी अपडेट: 28 सितंबर 2026',
    intro: 'FoodGuard India आपको यह समझने में मदद करता है कि पैकेज्ड फ़ूड में क्या है। यह पॉलिसी बताती है कि ऐप कौन-सी जानकारी इस्तेमाल करता है, वह कहां जाती है, और क्या सिर्फ़ आपके फ़ोन पर रहता है। संक्षेप में: कोई अकाउंट नहीं है, हम आपका नाम, फ़ोन नंबर या ईमेल नहीं मांगते, आपकी लोकेशन ट्रैक नहीं करते, और ऐप में कोई विज्ञापन या ट्रैकिंग टूल नहीं है।',
    contactFallback: 'प्राइवेसी से जुड़े किसी भी सवाल या अनुरोध के लिए, ऐप में किसी भी प्रोडक्ट पर "इस रिज़ल्ट में कोई समस्या बताएं" का इस्तेमाल करें और नोट में अपना सवाल लिखें, या ऐप के Play Store पेज से डेवलपर से संपर्क करें।',
    contactPrefix: 'प्राइवेसी से जुड़े किसी भी सवाल या अनुरोध के लिए लिखें:',
    languageNote: 'यह अंग्रेज़ी पॉलिसी का हिंदी अनुवाद है। दोनों में कोई फ़र्क़ होने पर अंग्रेज़ी संस्करण मान्य होगा।',
    sections: [
      {
        h: 'संक्षेप में',
        list: [
          'ऐप इस्तेमाल करने वालों के लिए कोई साइन-अप या लॉगिन नहीं। हम आपका नाम, फ़ोन नंबर, ईमेल या लोकेशन नहीं लेते।',
          'आपकी स्कैन हिस्ट्री, फ़ैमिली प्रोफ़ाइल (एलर्जी समेत), इनटेक लॉग और सेटिंग्स सिर्फ़ आपके डिवाइस पर रहती हैं।',
          'लेबल या पैक की जो फ़ोटो आप लेते हैं, वह टेक्स्ट पढ़ने के लिए Google की Gemini सर्विस को भेजी जाती है, और FoodGuard उसे सेव नहीं करता।',
          'जब आप कोई ऐसा प्रोडक्ट एनालाइज़ करते हैं जो FoodGuard में नया है, तो उसका नाम, इंग्रीडिएंट्स और रिज़ल्ट FoodGuard के साझा प्रोडक्ट कैटलॉग में जुड़ जाते हैं ताकि दूसरे भी उसे ढूंढ सकें। उसके साथ आपकी कोई जानकारी नहीं जुड़ती।',
          'कोई विज्ञापन नहीं, कोई एनालिटिक्स नहीं, दूसरी ऐप्स या वेबसाइटों पर कोई ट्रैकिंग नहीं। हम डेटा नहीं बेचते।',
        ],
      },
      {
        h: '1. हम कौन हैं',
        p: ['FoodGuard India ("FoodGuard", "हम") एक स्वतंत्र ऐप है जो पैकेज्ड फ़ूड को उसके इंग्रीडिएंट्स और न्यूट्रिशन के आधार पर स्कोर करता है, FSSAI (भारत) और EU/EFSA मानकों से मिलाकर। यह FSSAI या किसी सरकारी संस्था से जुड़ा नहीं है।'],
      },
      {
        h: '2. जानकारी जो सिर्फ़ आपके डिवाइस पर रहती है',
        p: ['ये आपके फ़ोन की ऐप स्टोरेज में (या वेबसाइट पर ब्राउज़र में) रहती हैं और कभी FoodGuard के सर्वर पर नहीं भेजी जातीं:'],
        list: [
          'स्कैन हिस्ट्री — आपने जो प्रोडक्ट चेक किए और उनके रिज़ल्ट।',
          'फ़ैमिली प्रोफ़ाइल — आपके चुने निकनेम, खाने की प्राथमिकताएं, और चुनी गई एलर्जी। पर्सनल स्कोर आपके डिवाइस पर ही निकाले जाते हैं।',
          'मेरा इनटेक — आप जो खाना लॉग करते हैं और उसका न्यूट्रिशन।',
          'पसंद — भाषा, थीम, शॉपिंग मोड और नोटिफ़िकेशन सेटिंग्स।',
          'एक रैंडम डिवाइस पहचान — आपके डिवाइस पर बनती है और आपसे जुड़ी नहीं है। यह सिर्फ़ तब भेजी जाती है जब आप बारकोड मैच कन्फ़र्म करते हैं (सेक्शन 3 देखें), ताकि अलग-अलग कन्फ़र्मेशन गिने जा सकें।',
        ],
        after: ['यह डेटा आप हिस्ट्री में "सब हटाएं", फ़ैमिली प्रोफ़ाइल डिलीट करके, फ़ोन सेटिंग्स में ऐप की स्टोरेज साफ़ करके, या ऐप अनइंस्टॉल करके हटा सकते हैं। सेटिंग्स में "Export backup" आपके डिवाइस पर एक फ़ाइल बनाता है जो सिर्फ़ आपके पास रहती है।'],
      },
      {
        h: '3. किसी फ़ीचर का इस्तेमाल करने पर भेजी जाने वाली जानकारी',
        p: ['कुछ फ़ीचर तभी काम करते हैं जब जानकारी FoodGuard के डेटाबेस या किसी सर्विस प्रोवाइडर को भेजी जाए। यह सिर्फ़ तब होता है जब आप वह फ़ीचर इस्तेमाल करते हैं:'],
        list: [
          'बारकोड स्कैन या सर्च: बारकोड नंबर या सर्च के शब्द FoodGuard के डेटाबेस में और Open Food Facts (एक मुफ़्त सार्वजनिक फ़ूड डेटाबेस) में खोजे जाते हैं।',
          'लेबल या पैक के आगे की फ़ोटो: फ़ोटो Google की Gemini API को भेजी जाती है ताकि उससे इंग्रीडिएंट्स, न्यूट्रिशन टेबल या प्रोडक्ट का नाम पढ़ा जा सके। FoodGuard ये फ़ोटो सेव नहीं करता।',
          'इंग्रीडिएंट्स एनालाइज़ करना: इंग्रीडिएंट टेक्स्ट और प्रोडक्ट का नाम Google की Gemini API को इंग्रीडिएंट्स रिसर्च करने और समझाने के लिए भेजा जाता है, और बना हुआ टेक्स्ट हिंदी अनुवाद के लिए Cloudflare Workers AI को भेजा जाता है।',
          'नए प्रोडक्ट: जब कोई प्रोडक्ट पहली बार एनालाइज़ होता है, तो उसका नाम, इंग्रीडिएंट टेक्स्ट, रिज़ल्ट और (बारकोड स्कैन पर) बारकोड FoodGuard के साझा कैटलॉग में सेव होता है, ताकि अगले व्यक्ति को रिज़ल्ट तुरंत मिले। नया प्रोडक्ट दूसरों को तभी दिखता है जब FoodGuard की टीम उसे रिव्यू कर ले। किसने स्कैन किया, यह सेव नहीं होता — कृपया प्रोडक्ट के नाम या नोट में कोई निजी जानकारी न लिखें।',
          'रिपोर्ट और नाम के सुझाव: आपने जो कारण चुना, जो नोट लिखा, जो नाम सुझाया, और रिज़ल्ट की वह कॉपी जो आपने देखी।',
          'प्रोडक्ट भेजना: आपकी ली हुई फ़ोटो (आगे, इंग्रीडिएंट्स, न्यूट्रिशन), बारकोड, और कोई नाम या नोट जो आप जोड़ें।',
          'बारकोड मैच: जब स्कैन किया बारकोड पहचाना नहीं जाता और आप मिलते प्रोडक्ट पर टैप करते हैं, तो बारकोड, प्रोडक्ट और रैंडम डिवाइस पहचान सेव होती है ताकि FoodGuard की टीम उन्हें जोड़ सके।',
          'शेयर करना: जब आप रिज़ल्ट शेयर करते हैं, तो शेयर टेक्स्ट और उस प्रोडक्ट की रिपोर्ट का लिंक आपकी चुनी ऐप (जैसे WhatsApp) को दिया जाता है।',
        ],
        after: ['FoodGuard, Google की मुफ़्त Gemini API इस्तेमाल करता है। Google की मुफ़्त इस्तेमाल की शर्तों के तहत, Google उसे भेजा गया कंटेंट (जैसे लेबल की फ़ोटो और इंग्रीडिएंट टेक्स्ट) अपनी सर्विसेज़ बेहतर करने में इस्तेमाल कर सकता है। कृपया सिर्फ़ प्रोडक्ट के पैक की फ़ोटो लें — लोगों, दस्तावेज़ों या किसी निजी चीज़ की नहीं।'],
      },
      {
        h: '4. ऐप जो परमिशन मांगता है',
        list: [
          'कैमरा — बारकोड स्कैन करने और लेबल या पैक की फ़ोटो लेने के लिए। सिर्फ़ स्कैन करते या फ़ोटो लेते समय इस्तेमाल होता है।',
          'फ़ोटो / फ़ाइलें — सिर्फ़ वह एक इमेज जो आप गैलरी से चुनते हैं।',
          'नोटिफ़िकेशन (Android) — वैकल्पिक रिमाइंडर, जो आपके डिवाइस पर ही बनते हैं। इन्हें सेटिंग्स में बंद कर सकते हैं। इन्हें सही समय पर दिखाने और फ़ोन रीस्टार्ट होने के बाद भी बनाए रखने के लिए, ऐप के पास अलार्म शेड्यूल करने और स्टार्ट-अप पर चलने की सामान्य Android परमिशन भी है।',
          'इंटरनेट और वाइब्रेशन — ऊपर की सर्विसेज़ तक पहुंचने के लिए, और रिज़ल्ट दिखने पर हल्के वाइब्रेशन के लिए।',
        ],
        after: ['ऐप लोकेशन, कॉन्टैक्ट्स, माइक्रोफ़ोन या फ़ोन की परमिशन नहीं मांगता।'],
      },
      {
        h: '5. सर्विस प्रोवाइडर',
        p: ['FoodGuard ऊपर के फ़ीचर चलाने के लिए इन प्रोवाइडर्स का इस्तेमाल करता है। हर प्रोवाइडर अपनी प्राइवेसी शर्तों के तहत डेटा संभालता है, और रिक्वेस्ट पूरी करते समय आपका IP एड्रेस जैसी तकनीकी जानकारी दर्ज कर सकता है:'],
        list: [
          'Supabase — FoodGuard का डेटाबेस और फ़ोटो स्टोरेज।',
          'Google (Gemini API) — फ़ोटो पढ़ना और इंग्रीडिएंट्स रिसर्च करना।',
          'Cloudflare (Workers AI) — रिज़ल्ट का हिंदी अनुवाद।',
          'Open Food Facts — बारकोड खोजने के लिए सार्वजनिक फ़ूड डेटाबेस।',
          'GitHub Pages — FoodGuard की वेबसाइट होस्ट करता है।',
        ],
      },
      {
        h: '6. हम क्या नहीं करते',
        list: [
          'हम कोई डेटा बेचते, किराए पर देते या बदलते नहीं।',
          'हम विज्ञापन नहीं दिखाते और एडवरटाइज़िंग ID इस्तेमाल नहीं करते।',
          'हम एनालिटिक्स या ट्रैकिंग टूल इस्तेमाल नहीं करते, और दूसरी ऐप्स या वेबसाइटों पर आपको फ़ॉलो नहीं करते।',
          'हम आपकी लोकेशन नहीं लेते।',
          'हम आपकी कोई प्रोफ़ाइल नहीं बनाते। स्कोर प्रोडक्ट के बारे में हैं, लोगों के बारे में नहीं।',
        ],
      },
      {
        h: '7. जानकारी कितने समय तक रखी जाती है',
        list: [
          'आपके डिवाइस पर: जब तक आप उसे डिलीट न करें या ऐप अनइंस्टॉल न करें।',
          'साझा प्रोडक्ट कैटलॉग: प्रोडक्ट कैटलॉग में रहते हैं ताकि दूसरे उनका इस्तेमाल कर सकें; उनमें आपकी कोई जानकारी नहीं होती।',
          'रिपोर्ट, सुझाव, भेजी गई फ़ोटो और बारकोड मैच: रिव्यू होने तक रखे जाते हैं, और उसके बाद क्या बदला इसके रिकॉर्ड के तौर पर। आप अपनी भेजी कोई चीज़ हटाने का अनुरोध कर सकते हैं।',
        ],
      },
      {
        h: '8. आपके विकल्प',
        p: ['आप बिना कोई निजी जानकारी दिए FoodGuard इस्तेमाल कर सकते हैं। आप अपने डिवाइस पर सेव हर चीज़ कभी भी डिलीट कर सकते हैं। अगर आप चाहते हैं कि आपकी भेजी कोई रिपोर्ट, फ़ोटो या सुझाव हटाया जाए, तो प्रोडक्ट और लगभग कब भेजा था यह बताकर हमसे संपर्क करें (सेक्शन 12)। FoodGuard कम से कम जानकारी लेकर भारत के डिजिटल व्यक्तिगत डेटा संरक्षण अधिनियम, 2023 का पालन करने का प्रयास करता है।'],
      },
      {
        h: '9. बच्चे',
        p: ['FoodGuard सभी के लिए है। इसमें कोई अकाउंट नहीं है और यह जानबूझकर किसी से भी, बच्चों समेत, निजी जानकारी नहीं लेता। बच्चों की फ़ैमिली प्रोफ़ाइल सिर्फ़ माता-पिता के डिवाइस पर रहती है।'],
      },
      {
        h: '10. यह मेडिकल सलाह नहीं है',
        p: ['स्कोर और जानकारी प्रोडक्ट के बारे में सामान्य जानकारी है, मेडिकल सलाह नहीं। अपनी डाइट या सेहत से जुड़े फ़ैसलों के लिए किसी योग्य हेल्थ प्रोफ़ेशनल से सलाह लें।'],
      },
      {
        h: '11. इस पॉलिसी में बदलाव',
        p: ['अगर ऐप जानकारी को अलग तरीके से इस्तेमाल करने लगे, तो यह पॉलिसी अपडेट होगी और ऊपर की तारीख़ बदलेगी। ज़रूरी बदलाव ऐप में बताए जाएंगे।'],
      },
      {
        h: '12. संपर्क',
        contact: true,
      },
    ],
  },
};
