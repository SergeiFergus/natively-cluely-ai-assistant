import React, { useEffect, useRef, useState } from 'react';

interface ChannelStatus {
    status: 'connected' | 'reconnecting' | 'failed' | 'awaiting-audio';
    error?: string;
    provider?: string;
}

interface RollingTranscriptProps {
    text: string;
    isActive?: boolean;
    surfaceStyle?: React.CSSProperties;
    interviewerChannel?: ChannelStatus;
    microphoneChannel?: ChannelStatus;
}

/**
 * Live transcript panel — a "running paragraph" of the interviewer channel.
 *
 * Renders as a wrapped multi-line paragraph capped at ~6 lines. New text
 * appends at the bottom and the panel follows it (chat-style auto-scroll) —
 * but only while the user is already at the bottom. Scrolling up detaches
 * the pin so earlier text can be read while transcription continues; a tap
 * on the "↓" chip (or scrolling back down) re-pins. The full history is
 * bounded upstream by ROLLING_TRANSCRIPT_MAX_CHARS and persisted to meeting
 * notes.
 */
const RollingTranscript: React.FC<RollingTranscriptProps> = ({
    text, isActive = true, surfaceStyle,
    interviewerChannel, microphoneChannel,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    // True while the view should follow the newest text. Detached by a manual
    // scroll away from the bottom; re-attached when the user returns there.
    const [pinnedToBottom, setPinnedToBottom] = useState(true);

    const intStatus = interviewerChannel?.status ?? 'connected';
    const micStatus = microphoneChannel?.status ?? 'connected';
    const anyAwaitingAudio = intStatus === 'awaiting-audio' || micStatus === 'awaiting-audio';
    const isNormal = intStatus === 'connected' && micStatus === 'connected' && !anyAwaitingAudio;
    const showTranscriptText = intStatus !== 'failed' && micStatus !== 'failed';

    useEffect(() => {
        if (containerRef.current && showTranscriptText && text && pinnedToBottom) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [text, showTranscriptText, pinnedToBottom]);

    const handleScroll = () => {
        const el = containerRef.current;
        if (!el) return;
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        setPinnedToBottom(distanceFromBottom < 28);
    };

    const jumpToLatest = () => {
        const el = containerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
        setPinnedToBottom(true);
    };

    return (
        <div className="relative w-full">
            <div className="w-[90%] mx-auto pt-2 relative">
                <div
                    ref={containerRef}
                    onScroll={handleScroll}
                    className="overflow-y-auto overlay-transcript-surface transition-colors duration-500 max-h-40 rounded-lg px-3 py-1.5 rolling-transcript-scroll"
                    style={{
                        ...surfaceStyle,
                        scrollbarWidth: 'thin',
                        scrollbarColor: 'rgba(148,163,184,0.35) transparent',
                        // Fade the OLDEST visible text at the top — but only
                        // while pinned to the newest line. When the user
                        // scrolls up to read, they need the top line legible.
                        ...(pinnedToBottom ? {
                            maskImage: 'linear-gradient(to bottom, transparent 0%, black 22%)',
                            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 22%)',
                        } : {}),
                    }}
                >
                    {showTranscriptText && (
                        <p className="whitespace-normal break-words text-left text-[13px] leading-6 text-[var(--overlay-text-muted)] m-0">
                            {text || 'Listening…'}
                            {isActive && isNormal && (
                                <span className="inline-flex items-center ml-2 align-middle">
                                    <span className="w-[3px] h-[3px] bg-emerald-400/70 rounded-full animate-pulse" />
                                </span>
                            )}
                        </p>
                    )}
                </div>
                {!pinnedToBottom && (
                    <button
                        type="button"
                        onClick={jumpToLatest}
                        className="absolute bottom-1.5 right-2 px-2 py-0.5 rounded-full text-[11px] leading-4 bg-black/40 text-white/80 hover:bg-black/60 backdrop-blur-sm no-drag"
                        title="К новому тексту"
                    >
                        ↓
                    </button>
                )}
            </div>
        </div>
    );
};

export default RollingTranscript;
