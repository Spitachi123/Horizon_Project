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
      navAiPresentation: 'AI Presentation',
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
      typeMessage: 'Type your message...',

      // ---- Landing page (index.html) ----
      navFeaturesLink: 'Features',
      navHowItWorksLink: 'How It Works',
      navMilestonesLink: 'Milestones',
      signInNav: 'Sign In',
      getStartedNav: 'Get Started',
      heroBadge: 'Zero Hesitation Learning Platform',
      heroTitlePlain1: 'Ask Anything.',
      heroTitleGradient: 'Break Down Complex Topics.',
      heroTitlePlain2: 'Reach Every Milestone.',
      heroSub: 'Anonymously ask doubts without fear of judgment, digest complex subjects in bite-sized chunks, and master coursework through structured milestone tracking.',
      ctaJoinClassroom: 'Join the Classroom',
      ctaExploreFeatures: 'Explore Features',
      chipAskAnon: 'Ask anonymously',
      chipBreakdowns: 'Bite-sized breakdowns',
      chipMilestoneTrack: 'Milestone tracking',
      ctaFooterTitle: 'Ready to Experience Fearless Learning?',
      ctaFooterSub: 'Set up your classroom in minutes — pick your role, sign up, and start tracking milestones today.',
      ctaFooterBtn: 'Get Started Now',

      // ---- Auth view (login / register form) ----
      brandTitleLogin: 'Next-Gen Interactive Learning',
      brandDescLogin: 'Access live virtual labs, real-time analytics, and collaborative smart classroom modules.',
      brandTitleRegister: 'Join ज्ञानSetu Today',
      brandDescRegister: 'Create your account to unlock personalized learning modules, analytics, and instant collaboration.',
      pillAnonQuestions: 'Anonymous Questions',
      pillContentBreakdown: 'Content Breakdown',
      pillMilestoneTasks: 'Milestone Tasks',
      formTitleWelcome: 'Welcome Back',
      formSubWelcome: 'Select your portal access mode to continue',
      formTitleCreate: 'Create Portal Account',
      formSubCreate: 'Set up your smart classroom access',
      fullNameLabel: 'Full Name',
      classGradeLabel: 'Class / Grade',
      subjectYouTeachLabel: 'Subject You Teach',
      subjectHint: "You'll only see anonymous questions and enter results for this subject. You can change it later from your dashboard.",
      passwordLabel: 'Password',
      forgotShort: 'Forgot?',
      keepSessionActive: 'Keep session active',
      dontHaveAccount: "Don't have an account?",
      alreadyHaveAccount: 'Already have an account?',
      studentAccessMode: 'Student Access Mode',
      newStudentReg: 'New Student Registration',
      teacherAccessMode: 'Educator Portal Mode',
      newFacultyAcct: 'New Faculty Account',
      studentIdOrEmail: 'Student ID or Email',
      studentEmailAddr: 'Student Email Address',
      facultyIdOrEmail: 'Faculty ID or Work Email',
      facultyEmailAddr: 'Faculty Email Address'
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
      navAiPresentation: 'AI प्रस्तुति',
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
      typeMessage: 'आफ्नो सन्देश टाइप गर्नुहोस्...',

      // ---- Landing page (index.html) ----
      navFeaturesLink: 'विशेषताहरू',
      navHowItWorksLink: 'यसले कसरी काम गर्छ',
      navMilestonesLink: 'माइलस्टोन',
      signInNav: 'साइन इन',
      getStartedNav: 'सुरु गर्नुहोस्',
      heroBadge: 'शून्य हिचकिचाहट सिकाइ प्लेटफर्म',
      heroTitlePlain1: 'जे पनि सोध्नुहोस्।',
      heroTitleGradient: 'जटिल विषयहरू सजिलो बनाउनुहोस्।',
      heroTitlePlain2: 'हरेक माइलस्टोन पूरा गर्नुहोस्।',
      heroSub: 'डर बिना गुमनाम रूपमा शंका सोध्नुहोस्, जटिल विषयहरूलाई सानो-सानो भागमा बुझ्नुहोस्, र संरचित माइलस्टोन ट्र्याकिङ मार्फत पाठ्यक्रम पूरा गर्नुहोस्।',
      ctaJoinClassroom: 'कक्षाकोठामा सामेल हुनुहोस्',
      ctaExploreFeatures: 'विशेषताहरू हेर्नुहोस्',
      chipAskAnon: 'गुमनाम रूपमा सोध्नुहोस्',
      chipBreakdowns: 'सानो-सानो भागमा विभाजन',
      chipMilestoneTrack: 'माइलस्टोन ट्र्याकिङ',
      ctaFooterTitle: 'निर्भीक सिकाइ अनुभव गर्न तयार हुनुहुन्छ?',
      ctaFooterSub: 'केही मिनेटमै आफ्नो कक्षाकोठा सेटअप गर्नुहोस् — भूमिका छान्नुहोस्, साइन अप गर्नुहोस्, र आजैदेखि माइलस्टोन ट्र्याक गर्न सुरु गर्नुहोस्।',
      ctaFooterBtn: 'अहिले नै सुरु गर्नुहोस्',

      // ---- Auth view (login / register form) ----
      brandTitleLogin: 'नयाँ पुस्ताको अन्तरक्रियात्मक सिकाइ',
      brandDescLogin: 'लाइभ भर्चुअल ल्याब, वास्तविक-समय विश्लेषण, र सहकार्यात्मक स्मार्ट कक्षाकोठा मोड्युलहरू प्रयोग गर्नुहोस्।',
      brandTitleRegister: 'आज नै ज्ञानSetu मा सामेल हुनुहोस्',
      brandDescRegister: 'व्यक्तिगत सिकाइ मोड्युल, विश्लेषण, र तत्काल सहकार्य अनलक गर्न आफ्नो खाता बनाउनुहोस्।',
      pillAnonQuestions: 'गुमनाम प्रश्नहरू',
      pillContentBreakdown: 'सामग्री विभाजन',
      pillMilestoneTasks: 'माइलस्टोन कार्यहरू',
      formTitleWelcome: 'फेरि स्वागत छ',
      formSubWelcome: 'जारी राख्न आफ्नो पोर्टल पहुँच मोड छान्नुहोस्',
      formTitleCreate: 'पोर्टल खाता खोल्नुहोस्',
      formSubCreate: 'आफ्नो स्मार्ट कक्षाकोठा पहुँच सेटअप गर्नुहोस्',
      fullNameLabel: 'पूरा नाम',
      classGradeLabel: 'कक्षा / ग्रेड',
      subjectYouTeachLabel: 'तपाईंले पढाउने विषय',
      subjectHint: 'तपाईंले यही विषयका गुमनाम प्रश्नहरू मात्र देख्नुहुनेछ र नतिजा प्रविष्ट गर्नुहुनेछ। तपाईं यसलाई पछि आफ्नो ड्यासबोर्डबाट परिवर्तन गर्न सक्नुहुन्छ।',
      passwordLabel: 'पासवर्ड',
      forgotShort: 'बिर्सनुभयो?',
      keepSessionActive: 'सत्र सक्रिय राख्नुहोस्',
      dontHaveAccount: 'खाता छैन?',
      alreadyHaveAccount: 'पहिले नै खाता छ?',
      studentAccessMode: 'विद्यार्थी पहुँच मोड',
      newStudentReg: 'नयाँ विद्यार्थी दर्ता',
      teacherAccessMode: 'शिक्षक पोर्टल मोड',
      newFacultyAcct: 'नयाँ शिक्षक खाता',
      studentIdOrEmail: 'विद्यार्थी आईडी वा इमेल',
      studentEmailAddr: 'विद्यार्थी इमेल ठेगाना',
      facultyIdOrEmail: 'शिक्षक आईडी वा कार्यालय इमेल',
      facultyEmailAddr: 'शिक्षक इमेल ठेगाना'
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
