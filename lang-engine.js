/* ============================================================
   LANG-ENGINE.JS — Nepali (Devanagari) / English site toggle.

   Two independent things happen when the user switches to Nepali:
     1. Every element marked [data-i18n="key"] gets its text swapped
        from the DICTIONARY below.
     2. The Nepali cultural theme mode (nepali-theme.css) is offered
        as the visual pairing — switching language does NOT force
        the theme, but the language panel offers a one-click "also
        switch to Nepali theme" shortcut, since most people will want
        both together.

   Adding a new translatable string: give the element
   data-i18n="someKey" and add someKey to DICTIONARY.en / .ne below.
   Elements without a dictionary entry are left as-is (not "walked
   past silently broken" — check the browser console, missing keys
   are logged as a warning in Nepali mode).
   ============================================================ */

const LangEngine = (() => {
  const STORAGE_KEY = 'divedu_lang_pref_v1';

  const DICTIONARY = {
    en: {
      appName: 'ज्ञानSetu',
      navOverview: 'Overview',
      navQuizzes: 'Quizzes',
      navAttendance: 'Attendance',
      navResults: 'Results',
      navMaterials: 'Materials',
      navHomework: 'Homework',
      navQna: 'Anonymous Q&A',
      navMilestones: 'Milestones',
      navIdCards: 'ID Cards',
      navAiAssistant: 'AI Assistant',
      navAiChatbot: 'AI Chatbot',
      navAiMindmap: 'AI Mind Map',
      navAiStudyDesk: 'AI Study Desk',
      navQuizStudent: 'Quizzes',
      navResultsStudent: 'My Results',
      navIdCardStudent: 'My ID Card',
      navAskQuestion: 'Ask a Question',
      logout: 'Logout',
      welcomeBack: 'Welcome back',
      namasteBanner: 'नमस्ते! Welcome — you can switch back to English anytime from the same menu.',
      login: 'Sign In',
      createAccount: 'Create Account',
      studentTab: 'Student',
      teacherTab: 'Teacher',
      email: 'Email',
      password: 'Password',
      forgot: 'Forgot password?',
      submitLogin: 'Enter Classroom',
      submitRegister: 'Register & Create Account',
      newChat: 'New chat',
      typeMessage: 'Type your message...'
    },
    ne: {
      appName: 'ज्ञानसेतु',
      navOverview: 'सिंहावलोकन',
      navQuizzes: 'क्विजहरू',
      navAttendance: 'हाजिरी',
      navResults: 'नतिजा',
      navMaterials: 'सामग्री',
      navHomework: 'गृहकार्य',
      navQna: 'गुमनाम प्रश्नोत्तर',
      navMilestones: 'माइलस्टोन',
      navIdCards: 'परिचयपत्र',
      navAiAssistant: 'AI सहायक',
      navAiChatbot: 'AI च्याटबोट',
      navAiMindmap: 'AI माइन्डम्याप',
      navAiStudyDesk: 'AI अध्ययन डेस्क',
      navQuizStudent: 'क्विजहरू',
      navResultsStudent: 'मेरो नतिजा',
      navIdCardStudent: 'मेरो परिचयपत्र',
      navAskQuestion: 'प्रश्न सोध्नुहोस्',
      logout: 'लगआउट',
      welcomeBack: 'फेरि स्वागत छ',
      namasteBanner: 'नमस्ते! तपाईं जुनसुकै बेला यही मेनुबाट अंग्रेजीमा फर्कन सक्नुहुन्छ।',
      login: 'साइन इन',
      createAccount: 'खाता खोल्नुहोस्',
      studentTab: 'विद्यार्थी',
      teacherTab: 'शिक्षक',
      email: 'इमेल',
      password: 'पासवर्ड',
      forgot: 'पासवर्ड बिर्सनुभयो?',
      submitLogin: 'कक्षाकोठामा प्रवेश गर्नुहोस्',
      submitRegister: 'खाता दर्ता गर्नुहोस्',
      newChat: 'नयाँ कुराकानी',
      typeMessage: 'आफ्नो सन्देश टाइप गर्नुहोस्...'
    }
  };

  function loadPref() {
    try { return localStorage.getItem(STORAGE_KEY) || 'en'; } catch (e) { return 'en'; }
  }
  function savePref(lang) {
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* ignore */ }
  }

  function apply(lang) {
    const dict = DICTIONARY[lang] || DICTIONARY.en;
    document.documentElement.setAttribute('lang', lang === 'ne' ? 'ne' : 'en');
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (dict[key] !== undefined) {
        el.textContent = dict[key];
      } else if (lang === 'ne') {
        console.warn('[LangEngine] missing Nepali string for key:', key);
      }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (dict[key] !== undefined) el.setAttribute('placeholder', dict[key]);
    });
    document.dispatchEvent(new CustomEvent('langChanged', { detail: { lang } }));
  }

  function setLang(lang) {
    savePref(lang);
    apply(lang);
  }

  function getLang() { return loadPref(); }
  function t(key) {
    const dict = DICTIONARY[loadPref()] || DICTIONARY.en;
    return dict[key] !== undefined ? dict[key] : (DICTIONARY.en[key] || key);
  }

  function init() {
    const lang = loadPref();
    const boot = () => apply(lang);
    if (document.body) boot();
    else document.addEventListener('DOMContentLoaded', boot);

    // Fires in every other same-origin document (dashboard <-> its
    // embedded iframes, other tabs) the instant the language changes
    // anywhere, so nothing needs a manual reload to catch up.
    window.addEventListener('storage', (e) => {
      if (e.key !== STORAGE_KEY) return;
      apply(loadPref());
    });
  }

  init();
  return { setLang, getLang, t, DICTIONARY };
})();
