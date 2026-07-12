import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

// ─── Lightweight in-house i18n ────────────────────────────────────────────────
// No external dependency. `t(englishText)` returns the Russian string when the
// language is 'ru' (falling back to the English text when a phrase isn't in the
// dictionary), or the English text unchanged when the language is 'en'.
// Keying the dictionary by the English source string keeps call sites readable
// (`{t('Start Natively')}`) and means untranslated phrases degrade gracefully to
// English instead of showing a raw key.
//
// Scope: key screens only (launcher home, settings menu, AI Providers, Audio,
// General). Abbreviations that read the same in both languages — API, AI, STT,
// RAG, URL, etc. — are intentionally left untranslated.

export type Lang = 'en' | 'ru';

const STORAGE_KEY = 'natively_lang';

// English source string → Russian translation.
const RU: Record<string, string> = {
    // ── Settings sidebar / navigation ──
    'General': 'Основные',
    'AI Providers': 'AI-провайдеры',
    'Skills': 'Навыки',
    'Calendar': 'Календарь',
    'Audio': 'Звук',
    'Keybinds': 'Горячие клавиши',
    'Sync': 'Синхронизация',
    'Intelligence': 'Интеллект',
    'Setup & Help': 'Настройка и помощь',
    'About': 'О программе',
    'Quit Natively': 'Выйти из Natively',
    'Close': 'Закрыть',
    'Settings': 'Настройки',
    'Language': 'Язык',

    // ── Launcher (home) ──
    'My Natively': 'Мой Natively',
    'Start Natively': 'Запустить Natively',
    'Detectable': 'Виден при захвате экрана',
    'Undetectable': 'Скрыт от захвата',
    'Today': 'Сегодня',
    'Search or ask anything...': 'Найти или спросить что угодно...',
    'Upcoming features': 'Скоро в приложении',
    'Link your calendar to': 'Подключите календарь, чтобы',
    'see upcoming events': 'видеть предстоящие события',
    'Connect calendar': 'Подключить календарь',

    // ── AI Providers ──
    'Pick a default model and connect the cloud, local, or custom providers you want available.':
        'Выберите модель по умолчанию и подключите нужные облачные, локальные или свои провайдеры.',
    'Active Model': 'Активная модель',
    'Applies to new chats instantly.': 'Применяется к новым чатам сразу.',
    'Cloud Providers': 'Облачные провайдеры',
    'Add API keys to unlock cloud AI models.': 'Добавьте API-ключи, чтобы разблокировать облачные AI-модели.',
    'Save': 'Сохранить',
    'Test Connection': 'Проверить соединение',
    'Fetch Models': 'Загрузить модели',
    'Saved': 'Сохранено',
    'Select model': 'Выберите модель',
    'Select Provider': 'Выберите провайдера',
    'Custom Providers': 'Свои провайдеры',
    'Add Provider': 'Добавить провайдера',

    // ── Audio ──
    'Speech Provider': 'Провайдер распознавания речи',
    'Choose the engine that transcribes audio to text.': 'Выберите движок, который переводит речь в текст.',
    'Privacy-first: runs 100% on your device': 'Приватно: работает на 100% на вашем устройстве',
    'Local Engine Configuration': 'Настройка локального движка',
    'Select the AI models you want to use for Speech-to-Text inference.':
        'Выберите AI-модели для распознавания речи (Speech-to-Text).',
    'Split Audio Channels': 'Разделять аудиоканалы',
    'Use different models for microphone and system audio':
        'Использовать разные модели для микрофона и системного звука',
    'Model Manager': 'Менеджер моделей',
    'Install': 'Установить',
    'Audio Configuration': 'Настройка звука',
    'Manage input and output devices.': 'Управление устройствами ввода и вывода.',
    'Select the primary language being spoken in the meeting.':
        'Выберите основной язык, на котором говорят на встрече.',
    'Test Sound': 'Проверить звук',

    // ── General settings ──
    'General settings': 'Основные настройки',
    'Customize how Natively works for you': 'Настройте Natively под себя',
    'Natively is currently detectable by screen-sharing.': 'Сейчас Natively виден при демонстрации экрана.',
    'Mouse Passthrough': 'Сквозные клики мыши',
    'Overlay stays visible but lets all mouse clicks pass through to the app beneath.':
        'Оверлей остаётся видимым, но все клики мыши проходят сквозь него в приложение под ним.',
    'Open Natively when you log in': 'Открывать Natively при входе в систему',
    'Natively will open automatically when you log in to your computer.':
        'Natively будет открываться автоматически при входе в систему.',
    'Do not save meetings': 'Не сохранять встречи',
    'Verbose debug logging': 'Подробное журналирование',
    'Print detailed audio, STT, and pipeline diagnostics': 'Выводить подробную диагностику звука, STT и пайплайна',
    'Interviewer Transcript': 'Транскрипт интервьюера',
    'Show real-time transcription of the interviewer': 'Показывать транскрипцию интервьюера в реальном времени',
    'Auto Scroll': 'Автопрокрутка',
    'Automatically scroll to the latest message as new responses arrive':
        'Автоматически прокручивать к последнему сообщению при новых ответах',
};

interface LanguageContextValue {
    lang: Lang;
    setLang: (l: Lang) => void;
    t: (text: string) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
    lang: 'en',
    setLang: () => {},
    t: (text: string) => text,
});

function readStoredLang(): Lang {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        return v === 'ru' ? 'ru' : 'en';
    } catch {
        return 'en';
    }
}

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [lang, setLangState] = useState<Lang>(readStoredLang);

    const setLang = useCallback((l: Lang) => {
        setLangState(l);
        try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
    }, []);

    // Keep other windows (settings-popup, overlay) in sync — the `storage` event
    // fires in every OTHER same-partition renderer when one of them writes.
    useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            if (e.key === STORAGE_KEY) setLangState(e.newValue === 'ru' ? 'ru' : 'en');
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    const t = useCallback(
        (text: string) => (lang === 'ru' ? (RU[text] ?? text) : text),
        [lang],
    );

    return (
        <LanguageContext.Provider value={{ lang, setLang, t }}>
            {children}
        </LanguageContext.Provider>
    );
};

export function useLanguage(): LanguageContextValue {
    return useContext(LanguageContext);
}

// Convenience hook: `const t = useT();` then `t('Save')`.
export function useT(): (text: string) => string {
    return useContext(LanguageContext).t;
}
