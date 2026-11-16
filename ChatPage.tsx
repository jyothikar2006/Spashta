import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Sparkles,
  Coffee,
  Heart,
  Compass,
  Smile,
  Trash2,
  Building,
  Music,
  Clock,
  CheckCheck,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { CompanionMode } from '../types';
import { SpashtaMascot } from '../components/mascot/SpashtaMascot';

export const ChatPage: React.FC = () => {
  const {
    companionMode,
    setCompanionMode,
    messages,
    sendMessage,
    clearChat,
    isAiTyping,
    currentHouse,
    totalBricksEarned,
    navigateTo,
  } = useApp();

  const [input, setInput] = useState('');
  const [selectedEmojiTarget, setSelectedEmojiTarget] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isAiTyping]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isAiTyping) return;
    const textToSend = input;
    setInput('');
    await sendMessage(textToSend);
  };

  // Disney-inspired radiant fairytale environment styles per mode
  const envStyles: Record<
    CompanionMode,
    {
      bgGradient: string;
      accentColor: string;
      title: string;
      vibe: string;
      icon: React.ReactNode;
      ambientDoodles: string[];
      cardBorder: string;
      pillBg: string;
    }
  > = {
    friend: {
      bgGradient: 'from-[#FFFDF9] via-[#FFF8EB] to-[#FFF0D9]',
      accentColor: '#F5C754',
      title: 'Friend Mode',
      vibe: 'Warm Café • Laughs, Banter & Real Talk',
      icon: <Coffee className="w-4 h-4 text-[#7A5B0B]" />,
      ambientDoodles: ['☕', '🥐', '✨', '🏰', '🍪'],
      cardBorder: 'border-[#FFE39A]',
      pillBg: 'bg-[#FFE39A]/60',
    },
    soulmate: {
      bgGradient: 'from-[#FAF7FD] via-[#F3EDFB] to-[#E9DCF8]',
      accentColor: '#A882ED',
      title: 'Soulmate Mode',
      vibe: 'Starlight Twilight • Deep Empathy & Gentle Listening',
      icon: <Heart className="w-4 h-4 text-[#8A63D2]" />,
      ambientDoodles: ['🌙', '⭐', '🕯️', '💜', '🌌'],
      cardBorder: 'border-[#C9B8F2]',
      pillBg: 'bg-[#C9B8F2]/40',
    },
    guide: {
      bgGradient: 'from-[#F4F9FE] via-[#EAF4FD] to-[#DDEEFC]',
      accentColor: '#60A5FA',
      title: 'Guide Mode',
      vibe: 'Socratic Mentorship • Problem Solving & Clear Decisions',
      icon: <Compass className="w-4 h-4 text-[#2563EB]" />,
      ambientDoodles: ['📜', '🧭', '🗝️', '💡', '📚'],
      cardBorder: 'border-[#A9D8F5]',
      pillBg: 'bg-[#A9D8F5]/40',
    },
  };

  const currentEnv = envStyles[companionMode];

  return (
    <div className={`flex-1 flex flex-col h-[calc(100vh-65px)] bg-gradient-to-b ${currentEnv.bgGradient} transition-colors duration-700 relative overflow-hidden text-[#292B42]`}>
      {/* Fairytale Background Floating Doodles */}
      <div className="absolute inset-0 pointer-events-none select-none z-0 overflow-hidden opacity-30">
        <div className="absolute top-12 left-16 text-3xl animate-float-slow">{currentEnv.ambientDoodles[0]}</div>
        <div className="absolute top-1/3 right-14 text-3xl animate-drift">{currentEnv.ambientDoodles[1]}</div>
        <div className="absolute bottom-24 left-1/4 text-2xl animate-pulse-glow">{currentEnv.ambientDoodles[2]}</div>
        <div className="absolute top-2/3 right-1/3 text-3xl animate-float-slow">{currentEnv.ambientDoodles[3]}</div>
      </div>

      {/* CHAT HEADER */}
      <div className="bg-white/95 backdrop-blur-md border-b-2 border-[#FFE39A] p-3 sm:px-6 flex items-center justify-between shrink-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="relative">
            <SpashtaMascot size="sm" mood={isAiTyping ? 'thinking' : 'welcoming'} />
            <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display font-black text-sm sm:text-base text-[#292B42]">
                SPASHTA
              </h2>
              <span
                className={`text-[11px] font-black px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-sm border ${currentEnv.cardBorder} ${currentEnv.pillBg} text-[#292B42]`}
              >
                {currentEnv.icon}
                <span>{currentEnv.title}</span>
              </span>
            </div>
            <p className="text-[11px] text-[#525672] hidden sm:block font-medium">
              {currentEnv.vibe}
            </p>
          </div>
        </div>

        {/* Center / Right controls */}
        <div className="flex items-center gap-2">
          {/* Quick Mode Switcher Pills */}
          <div className="hidden md:flex items-center bg-[#FFF0D9] p-1 rounded-2xl border-2 border-[#FFE39A]">
            <button
              onClick={() => setCompanionMode('friend')}
              className={`px-3 py-1 rounded-xl text-xs font-black transition cursor-pointer ${
                companionMode === 'friend'
                  ? 'bg-white text-[#292B42] shadow-sm'
                  : 'text-[#525672] hover:text-[#292B42]'
              }`}
            >
              ☕ Friend
            </button>
            <button
              onClick={() => setCompanionMode('soulmate')}
              className={`px-3 py-1 rounded-xl text-xs font-black transition cursor-pointer ${
                companionMode === 'soulmate'
                  ? 'bg-white text-[#292B42] shadow-sm'
                  : 'text-[#525672] hover:text-[#292B42]'
              }`}
            >
              🌙 Soulmate
            </button>
            <button
              onClick={() => setCompanionMode('guide')}
              className={`px-3 py-1 rounded-xl text-xs font-black transition cursor-pointer ${
                companionMode === 'guide'
                  ? 'bg-white text-[#292B42] shadow-sm'
                  : 'text-[#525672] hover:text-[#292B42]'
              }`}
            >
              🧭 Guide
            </button>
          </div>

          {/* Active House Brick Indicator */}
          {currentHouse && (
            <button
              onClick={() => navigateTo('construction')}
              className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-white border-2 border-[#FFE39A] text-xs font-black text-[#292B42] shadow-sm hover:scale-105 transition cursor-pointer"
            >
              <Building className="w-3.5 h-3.5 text-[#F5C754]" />
              <span>{currentHouse.percentage}% Built</span>
            </button>
          )}

          {/* Clear Chat */}
          <button
            onClick={() => {
              if (window.confirm('Clear conversation history?')) {
                clearChat();
              }
            }}
            className="p-2 rounded-2xl bg-white hover:bg-rose-50 text-[#525672] hover:text-rose-600 transition border-2 border-[#E8E2D5] cursor-pointer shadow-sm"
            title="Clear Chat"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* MESSAGES FEED */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 max-w-4xl mx-auto w-full z-10">
        {messages.map((msg, index) => {
          const isUser = msg.sender === 'user';
          const time = new Date(msg.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });

          return (
            <div
              key={msg.id || index}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} group animate-fadeIn`}
            >
              {/* Message Bubble Row */}
              <div
                className={`flex items-end gap-2.5 max-w-[88%] sm:max-w-[78%] ${
                  isUser ? 'flex-row-reverse' : 'flex-row'
                }`}
              >
                {!isUser && (
                  <div className="shrink-0 mb-1">
                    <SpashtaMascot size="sm" mood={isAiTyping ? 'thinking' : 'welcoming'} />
                  </div>
                )}

                <div
                  className={`rounded-3xl p-4 sm:p-5 relative transition-all duration-200 ${
                    isUser
                      ? 'bg-gradient-to-r from-[#FFE39A] via-[#FFD770] to-[#F5C754] text-[#292B42] rounded-br-xs shadow-md border-2 border-[#F5C754]'
                      : 'bg-white text-[#292B42] rounded-bl-xs border-2 border-[#FFE39A] shadow-sm'
                  }`}
                >
                  {/* Sender title & mode */}
                  <div className="flex items-center justify-between gap-3 text-[11px] mb-1.5 opacity-80 font-bold">
                    <span>{isUser ? 'You' : 'Spashy'}</span>
                    <span className="text-[10px] opacity-75 font-mono">{time}</span>
                  </div>

                  {/* Message Text */}
                  <div className="text-sm sm:text-base leading-relaxed whitespace-pre-wrap font-medium">
                    {msg.text}
                  </div>

                  {/* Clarity Brick Awarded Badge inside bubble */}
                  {msg.brickAwarded && (
                    <div className="mt-3 pt-2.5 border-t border-[#FFE39A] flex items-center justify-between text-xs font-black text-[#7A5B0B] bg-[#FFF0D9]/80 p-2 rounded-2xl">
                      <span className="flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-[#F5C754]" />
                        <span>+1 Clarity Brick Earned!</span>
                      </span>
                      <button
                        onClick={() => navigateTo('construction')}
                        className="underline text-[11px] hover:text-[#292B42]"
                      >
                        Add to sanctuary →
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Message Meta / Emoji reactions */}
              <div
                className={`flex items-center gap-1.5 mt-1 px-2 text-[10px] text-[#525672] ${
                  isUser ? 'justify-end' : 'justify-start ml-9'
                }`}
              >
                {isUser && (
                  <span className="flex items-center gap-0.5 text-emerald-700 font-bold">
                    <CheckCheck className="w-3 h-3" />
                    <span>Delivered</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {/* Mascot Thinking / Typing Indicator */}
        {isAiTyping && (
          <div className="flex items-center gap-3 animate-pulse">
            <div className="shrink-0">
              <SpashtaMascot size="sm" mood="thinking" />
            </div>
            <div className="bg-white border-2 border-[#FFE39A] rounded-2xl px-4 py-3 shadow-sm flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#F5C754] animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 rounded-full bg-[#F5C754] animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 rounded-full bg-[#F5C754] animate-bounce" style={{ animationDelay: '300ms' }} />
              <span className="text-xs text-[#7A5B0B] font-bold ml-1.5">Spashy is reflecting...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* CHAT COMPOSER DOCK */}
      <div className="p-3 sm:p-5 bg-white/95 backdrop-blur-xl border-t-2 border-[#FFE39A] shrink-0 z-20 shadow-lg">
        <form
          onSubmit={handleSend}
          className="max-w-4xl mx-auto flex items-center gap-2 relative"
        >
          <div className="flex-1 relative flex items-center">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={
                companionMode === 'friend'
                  ? 'Tell Spashy about your day, gossip, or what made you smile...'
                  : companionMode === 'soulmate'
                  ? 'Pour your heart out gently. What feels heavy or quiet right now?'
                  : 'Ask for structured clarity, break a problem down, or decide next steps...'
              }
              disabled={isAiTyping}
              className="w-full bg-[#FFFDF9] border-2 border-[#FFE39A] focus:border-[#F5C754] text-[#292B42] placeholder-[#8C90A8] rounded-2xl py-3.5 pl-4 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFE39A] transition font-medium"
            />

            <button
              type="button"
              onClick={() => {
                const samplePrompts = [
                  "I'm feeling overwhelmed with everything on my plate today.",
                  "Can you help me see things from a clearer angle?",
                  "I had a really lovely small win today that made me smile!",
                  "I feel stuck between two decisions and don't know what to do.",
                ];
                const randomPrompt = samplePrompts[Math.floor(Math.random() * samplePrompts.length)];
                setInput(randomPrompt);
              }}
              className="absolute right-3 text-xs text-[#7A5B0B] hover:text-[#292B42] font-black cursor-pointer bg-[#FFF0D9] px-2 py-1 rounded-xl border border-[#FFE39A]"
              title="Need an idea? Insert sample prompt"
            >
              💡 Prompt
            </button>
          </div>

          <button
            type="submit"
            disabled={!input.trim() || isAiTyping}
            className="p-3.5 rounded-2xl bg-gradient-to-r from-[#FFE39A] via-[#FFD770] to-[#F5C754] hover:shadow-xl hover:scale-105 active:scale-95 disabled:opacity-40 text-[#292B42] font-black shadow-md transition flex items-center justify-center cursor-pointer border border-[#F5C754] shrink-0"
            aria-label="Send message"
          >
            <Send className="w-5 h-5 stroke-[2.5]" />
          </button>
        </form>

        <div className="max-w-4xl mx-auto flex items-center justify-between text-[11px] text-[#525672] mt-2 px-1 font-medium">
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-[#F5C754]" />
            <span>Honest reflections earn Clarity Bricks for your home.</span>
          </span>
          <span className="hidden sm:inline">Press Enter to send</span>
        </div>
      </div>
    </div>
  );
};
