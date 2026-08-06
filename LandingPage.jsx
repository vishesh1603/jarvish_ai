import React, { useState, useEffect } from 'react';

/**
 * Jarvish AI Landing Page Component
 * ==============================================================
 * A premium, responsive, dark-mode landing page featuring:
 *   - Screen 1: A 2-second animated splash screen with a glowing orb.
 *   - Screen 2: A welcome screen with staggered fade-in animations,
 *     bold typography, and a glowing CTA button.
 *
 * Props:
 *   - onStartChat: Callback function triggered when "Start Chatting" is clicked.
 *                  Can also be used for routing (e.g. navigating to /chat).
 * ==============================================================
 */
export default function LandingPage({ onStartChat }) {
  const [screen, setScreen] = useState(1); // 1 = Splash, 2 = Welcome
  const [fadeSplash, setFadeSplash] = useState(false); // Controls splash fade-out
  
  // Welcome screen staggered element visibility states
  const [showWordmark, setShowWordmark] = useState(false);
  const [showHeadline, setShowHeadline] = useState(false);
  const [showSubheading, setShowSubheading] = useState(false);
  const [showCTA, setShowCTA] = useState(false);
  const [showFooter, setShowFooter] = useState(false);

  useEffect(() => {
    // Screen 1 (Splash Screen) auto-dismisses after 2 seconds
    const splashTimer = setTimeout(() => {
      setFadeSplash(true); // Trigger fade-out animation
      
      // Complete transition to Screen 2 after fade-out finishes
      const transitionTimer = setTimeout(() => {
        setScreen(2);
      }, 500); // 500ms fade transition

      return () => clearTimeout(transitionTimer);
    }, 2000);

    return () => clearTimeout(splashTimer);
  }, []);

  useEffect(() => {
    if (screen === 2) {
      // Stagger welcome screen elements (~200ms delay increments)
      const t1 = setTimeout(() => setShowWordmark(true), 100);
      const t2 = setTimeout(() => setShowHeadline(true), 300);
      const t3 = setTimeout(() => setShowSubheading(true), 500);
      const t4 = setTimeout(() => setShowCTA(true), 700);
      const t5 = setTimeout(() => setShowFooter(true), 900);

      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
        clearTimeout(t4);
        clearTimeout(t5);
      };
    }
  }, [screen]);

  const handleStartChat = () => {
    if (onStartChat) {
      onStartChat();
    } else {
      console.log('onStartChat callback triggered! Route to /chat or set your app state.');
    }
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#07070C] text-[#F1F1F3] font-sans antialiased select-none">
      
      {/* Background ambient radial glow matching Jarvish's primary colors */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-30">
        <div className="absolute top-[-10%] left-[20%] w-[60%] h-[50%] rounded-full bg-gradient-to-br from-violet-600/20 to-cyan-500/10 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[10%] w-[50%] h-[50%] rounded-full bg-gradient-to-tr from-cyan-600/10 to-violet-500/20 blur-[100px]" />
      </div>

      {/* ========================================================= */}
      {/* SCREEN 1 — SPLASH SCREEN                                  */}
      {/* ========================================================= */}
      {screen === 1 && (
        <div
          className={`absolute inset-0 z-50 flex flex-col items-center justify-center transition-opacity duration-500 bg-[#07070C] ${
            fadeSplash ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
        >
          {/* Glowing Animated Orb Logo */}
          <div className="relative flex items-center justify-center w-32 h-32 md:w-40 md:h-40">
            {/* Outer soft glowing bloom */}
            <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-violet-500 to-cyan-400 opacity-40 blur-2xl animate-pulse duration-2000" />
            
            {/* Mid layered glow */}
            <div className="absolute inset-2 rounded-full bg-gradient-to-br from-violet-600 to-cyan-500 opacity-60 blur-md animate-pulse" />
            
            {/* Core sphere */}
            <div className="absolute inset-6 rounded-full bg-gradient-to-tr from-white/20 via-violet-500 to-cyan-400 shadow-[0_0_30px_rgba(167,139,250,0.5)] border border-white/10 flex items-center justify-center">
              <span className="text-white text-3xl md:text-4xl font-extrabold tracking-wider filter drop-shadow-[0_2px_10px_rgba(0,0,0,0.3)]">J</span>
            </div>

            {/* Orbiting particle ring */}
            <div className="absolute inset-[-10%] border border-dashed border-violet-500/30 rounded-full animate-[spin_10s_linear_infinite]" />
          </div>

          <h2 className="mt-8 text-xl font-semibold tracking-[0.2em] text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-cyan-300 animate-pulse uppercase">
            Jarvish AI
          </h2>
        </div>
      )}

      {/* ========================================================= */}
      {/* SCREEN 2 — WELCOME SCREEN                                 */}
      {/* ========================================================= */}
      {screen === 2 && (
        <div className="relative z-10 w-full h-full flex flex-col items-center justify-between px-6 py-12 md:py-20 text-center">
          
          {/* Top Logo / Wordmark */}
          <div
            className={`flex items-center gap-2.5 transition-all duration-700 transform ${
              showWordmark ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
            }`}
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-400 flex items-center justify-center font-bold text-white shadow-[0_0_15px_rgba(167,139,250,0.4)]">
              J
            </div>
            <span className="text-sm font-semibold tracking-[0.25em] text-transparent bg-clip-text bg-gradient-to-r from-violet-300 to-cyan-200 uppercase">
              Jarvish AI
            </span>
          </div>

          {/* Central Welcome Hero */}
          <div className="max-w-2xl flex flex-col items-center gap-6 my-auto">
            {/* Headline */}
            <h1
              className={`text-5xl md:text-7xl font-extrabold tracking-tight transition-all duration-700 transform ${
                showHeadline ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
              }`}
            >
              Meet{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 via-fuchsia-400 to-cyan-300 filter drop-shadow-[0_2px_20px_rgba(167,139,250,0.2)]">
                Jarvish
              </span>
            </h1>

            {/* Subheading */}
            <p
              className={`text-base md:text-xl text-[#9494A3] max-w-md md:max-w-xl leading-relaxed transition-all duration-700 transform ${
                showSubheading ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
              }`}
            >
              Your AI teacher.{' '}
              <span className="text-violet-300/80 font-medium">Always listening.</span>{' '}
              <span className="text-cyan-300/80 font-medium">Always learning.</span>{' '}
              <span className="text-[#F1F1F3]">Always here.</span>
            </p>

            {/* CTA Button */}
            <div
              className={`mt-6 transition-all duration-700 transform ${
                showCTA ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-95'
              }`}
            >
              <button
                onClick={handleStartChat}
                className="relative group px-8 py-4 rounded-full font-semibold text-white tracking-wide bg-gradient-to-r from-violet-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 transition-all duration-300 shadow-[0_0_30px_rgba(139,92,246,0.3)] hover:shadow-[0_0_40px_rgba(139,92,246,0.5)] hover:scale-105 active:scale-98 overflow-hidden"
              >
                {/* Glowing hover light inside button */}
                <div className="absolute inset-0 w-1/2 h-full bg-white/10 skew-x-12 -translate-x-full group-hover:animate-[shimmer_1s_ease-in-out_forwards]" />
                
                <span className="flex items-center gap-2">
                  Start Chatting 
                  <svg className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </span>
              </button>
            </div>
          </div>

          {/* Footer branding */}
          <div
            className={`transition-all duration-700 transform ${
              showFooter ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
          >
            <p className="text-[10px] md:text-xs tracking-[0.15em] text-[#5A5A6E] font-medium uppercase">
              Powered by{' '}
              <span className="text-[#9494A3] hover:text-[#A78BFA] transition-colors duration-300 cursor-default">
                Learnzo Bharat Education
              </span>
            </p>
          </div>

        </div>
      )}

    </div>
  );
}
