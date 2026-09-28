// src/pages/Privacy.jsx
// The privacy policy (content in src/data/privacyPolicy.js). Public route
// -- its URL is the one to give the Play Store listing.
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { PRIVACY_POLICY, PRIVACY_CONTACT_EMAIL } from '../data/privacyPolicy';

export default function Privacy() {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const policy = PRIVACY_POLICY[language] || PRIVACY_POLICY.en;

  return (
    <div className="page-in max-w-2xl mx-auto px-4 py-6 pb-24">
      <button
        onClick={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/settings'))}
        className="tap-scale inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 mb-4"
      >
        ← {language === 'hi' ? 'वापस' : 'Back'}
      </button>
      <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{policy.title}</h1>
      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 mb-4">{policy.updated}</p>
      {policy.languageNote && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 p-3 rounded-xl bg-slate-100 dark:bg-slate-800">{policy.languageNote}</p>
      )}
      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-5">{policy.intro}</p>

      {policy.sections.map((sec) => (
        <section key={sec.h} className="mb-5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4">
          <h2 className="text-[15px] font-bold text-slate-800 dark:text-slate-100 mb-2">{sec.h}</h2>
          {(sec.p || []).map((para) => (
            <p key={para.slice(0, 40)} className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-2">{para}</p>
          ))}
          {sec.list && (
            <ul className="space-y-1.5 mb-1">
              {sec.list.map((item) => (
                <li key={item.slice(0, 40)} className="flex gap-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  <span className="text-green-600 flex-shrink-0">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
          {(sec.after || []).map((para) => (
            <p key={para.slice(0, 40)} className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mt-2">{para}</p>
          ))}
          {sec.contact && (
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {PRIVACY_CONTACT_EMAIL
                ? <>{policy.contactPrefix} <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="text-green-600 font-semibold">{PRIVACY_CONTACT_EMAIL}</a></>
                : policy.contactFallback}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
