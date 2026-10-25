import React, { useState, useEffect, useRef, useId } from 'react';
import { Bot, User, Stethoscope, Pill, Locate, Coffee, ShieldAlert, ChevronRight, Apple, Activity, ClipboardList, LogOut, MapPin, Star, Phone, Clock, ExternalLink } from 'lucide-react';
import { MedicalAdvice } from './types.ts';
import { motion, AnimatePresence } from 'motion/react';
import { supabase, isSupabaseConfigured } from './lib/supabaseClient.ts';
import Auth from './Auth.tsx';

// Google Maps Platform access is proxied through the Express backend
// (/api/places/*) so the API key never reaches the browser.

interface PlaceSuggestion {
  placeId: string;
  text: string;
  mainText?: string;
  secondaryText?: string;
}

interface ClinicPlace {
  name: string;
  address?: string;
  lat: number;
  lng: number;
  rating?: number;
  userRatingCount?: number;
  phone?: string;
  googleMapsUri?: string;
  openNow?: boolean;
}

function LocationInput({ value, onChange }: { value: string, onChange: (val: string) => void }) {
  const listId = useId();
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [announcement, setAnnouncement] = useState('');
  // Set when the value changes because the user picked a suggestion, so we
  // don't immediately re-query for the text we just committed.
  const skipNextFetch = useRef(false);
  // One session token per typing session groups autocomplete requests for billing.
  const sessionToken = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      return;
    }
    const input = value.trim();
    if (input.length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/places/autocomplete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input, sessionToken: sessionToken.current }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: { suggestions: PlaceSuggestion[] } = await res.json();
        setSuggestions(data.suggestions);
        setActiveIndex(-1);
        setOpen(data.suggestions.length > 0);
        setAnnouncement(
          data.suggestions.length
            ? `${data.suggestions.length} location suggestions available.`
            : '',
        );
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          // Autocomplete is a convenience: on failure the field still accepts free text.
          console.warn('[LocationInput] autocomplete unavailable:', err);
          setSuggestions([]);
          setOpen(false);
        }
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value]);

  const select = (s: PlaceSuggestion) => {
    skipNextFetch.current = true;
    onChange(s.text);
    setOpen(false);
    setSuggestions([]);
    setActiveIndex(-1);
    sessionToken.current = crypto.randomUUID();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault(); // pick the suggestion instead of submitting the form
      select(suggestions[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  const optionId = (i: number) => `${listId}-opt-${i}`;

  return (
    <div className="relative z-[60]">
      <MapPin className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-pine" aria-hidden="true" />
      <input
        id="location"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        autoComplete="off"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        // Delay so a click on an option registers before the list closes.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="field block w-full py-2.5 pl-10 pr-3 text-sm"
        placeholder="Start typing an address or area..."
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Location suggestions"
        hidden={!open}
        className="absolute left-0 right-0 mt-1 max-h-64 overflow-auto rounded-xl border border-ink/10 bg-white shadow-lg py-1"
      >
        {suggestions.map((s, i) => (
          <li
            key={s.placeId}
            id={optionId(i)}
            role="option"
            aria-selected={i === activeIndex}
            // mousedown fires before the input's blur.
            onMouseDown={e => {
              e.preventDefault();
              select(s);
            }}
            onMouseEnter={() => setActiveIndex(i)}
            className={`cursor-pointer px-3 py-2 text-sm ${i === activeIndex ? 'bg-pine/10' : ''}`}
          >
            <span className="block font-medium text-ink">{s.mainText || s.text}</span>
            {s.secondaryText && <span className="block text-xs text-ink/55">{s.secondaryText}</span>}
          </li>
        ))}
      </ul>
      <p className="sr-only" aria-live="polite">{announcement}</p>
    </div>
  );
}

export default function App() {
  return <MainApp />;
}

function MainApp() {
  const [patientName, setPatientName] = useState('');
  const [symptoms, setSymptoms] = useState('');
  const [location, setLocation] = useState('');
  const [consultLocation, setConsultLocation] = useState('');
  
  const [isLoading, setIsLoading] = useState(false);
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  const [result, setResult] = useState<MedicalAdvice | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Supabase Auth session state
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setAuthLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    if (supabase) await supabase.auth.signOut();
  };

  if (isSupabaseConfigured) {
    if (authLoading) {
      return (
        <div className="app-shell min-h-screen flex items-center justify-center font-sans">
          <div className="relative z-10 flex items-center gap-3 text-sage">
            <Activity className="w-5 h-5 animate-pulse text-pine" />
            <span className="text-sm font-medium">Loading…</span>
          </div>
        </div>
      );
    }
    if (!session) {
      return <Auth />;
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patientName || !symptoms) return;

    setIsLoading(true);
    setResult(null);
    setError(null);

    try {
      // Simulate multi-agent steps visually
      setActiveAgent('front-desk');
      await new Promise(r => setTimeout(r, 1200));
      
      setActiveAgent('clinic-seeker');
      await new Promise(r => setTimeout(r, 1500));
      
      setActiveAgent('pharmacy-guide');
      await new Promise(r => setTimeout(r, 1500));

      setActiveAgent('risk-assessment');
      await new Promise(r => setTimeout(r, 1000));

      setActiveAgent('follow-up');
      await new Promise(r => setTimeout(r, 1200));

      setActiveAgent('synthesizing');

      // Safety net: if React state never captured the location (autocomplete
      // events can be unreliable), read it straight from the input in the DOM.
      // The input may live in the autocomplete's shadow DOM, so check both.
      let resolvedLocation = location;
      if (!resolvedLocation) {
        const host = document.querySelector('.medical-location-input gmp-place-autocomplete') as any;
        const domInput =
          (host?.shadowRoot?.querySelector('input') as HTMLInputElement | null) ||
          document.querySelector<HTMLInputElement>('.medical-location-input input');
        if (domInput?.value) resolvedLocation = domInput.value;
      }

      setConsultLocation(resolvedLocation);

      // Actual fetch
      const response = await fetch('/api/consult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientName, symptoms, location: resolvedLocation }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data: MedicalAdvice = await response.json();
      setResult(data);

      // Simple local storage persistence mock
      const existingStr = localStorage.getItem('patientsHistory');
      let pHistory: Record<string, string[]> = existingStr ? JSON.parse(existingStr) : {};
      pHistory[patientName] = pHistory[patientName] || [];
      pHistory[patientName].push(new Date().toISOString() + ': ' + symptoms);
      localStorage.setItem('patientsHistory', JSON.stringify(pHistory));

    } catch (err: any) {
      setError(err.message || 'An error occurred during consultation.');
    } finally {
      setIsLoading(false);
      setActiveAgent(null);
    }
  };

  return (
    <div className="app-shell min-h-screen text-ink selection:bg-pine/15 selection:text-pine font-sans pb-24">
      {/* Header */}
      <header className="relative z-10 max-w-6xl mx-auto px-4 pt-6">
        <div className="surface px-5 py-4 rounded-2xl flex items-center justify-between">
          <div className="flex items-center space-x-4">
             <div className="w-11 h-11 rounded-xl bg-pine flex items-center justify-center text-canvas shadow-[0_10px_24px_-12px_rgba(15,76,69,0.8)]">
                <Activity size={20} />
             </div>
             <div>
                <h1 className="text-2xl font-display font-semibold tracking-tight text-ink leading-none">HealthAgent AI</h1>
                <p className="text-[10px] text-sage mt-1 font-semibold uppercase tracking-[0.22em]">Multi-Agent Diagnostic Suite</p>
             </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="hidden sm:block text-right">
              <p className="text-[10px] text-ink/40 uppercase font-bold tracking-[0.16em]">System Status</p>
              <p className="text-sm text-pine-soft font-semibold flex items-center gap-1.5 justify-end">
                <span className="w-2 h-2 bg-pine-soft rounded-full inline-block animate-pulse"></span> Active
              </p>
            </div>
            {session && (
              <div className="flex items-center gap-3">
                <span className="hidden sm:inline text-sm text-ink/55 font-medium truncate max-w-[160px]">
                  {session.user?.email}
                </span>
                <button
                  onClick={handleSignOut}
                  title="Sign out"
                  className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-ink/55 hover:text-clay border border-ink/10 hover:border-clay/30 rounded-xl px-3 py-2 transition-colors"
                >
                  <LogOut className="w-4 h-4" /> <span className="hidden sm:inline">Sign Out</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-6xl mx-auto px-4 mt-8">
        
        {/* Intro Section */}
        {!result && !isLoading && (
          <div className="text-center mb-12 mt-14 animate-in fade-in slide-in-from-bottom-4 duration-700">
             <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-pine bg-mist border border-pine/10 rounded-full px-4 py-1.5 mb-6">
                <span className="w-1.5 h-1.5 rounded-full bg-pine-soft"></span> Calm, considered care
             </span>
             <h2 className="text-4xl sm:text-5xl font-display font-semibold tracking-tight text-ink mb-5 leading-[1.08]">
                Your AI Medical <span className="italic text-pine">Assistant</span>
             </h2>
             <p className="text-ink/55 max-w-xl mx-auto text-lg leading-relaxed">
                Describe your minor symptoms below. Our multi-agent system will quickly direct you to a nearby clinic, suggest OTC meds, and provide dietary guidance.
             </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
          
          {/* Form Column */}
          <div className={`col-span-1 transition-all duration-500 ${result || isLoading ? 'md:col-span-4 lg:col-span-4' : 'md:col-span-12 lg:col-span-8 lg:col-start-3'}`}>
            <div className="surface rounded-3xl p-6">
              <div className="flex items-center gap-2 mb-5 text-pine">
                <span className="w-7 h-7 rounded-lg bg-mist flex items-center justify-center">
                  <Bot className="w-4 h-4" />
                </span>
                <h2 className="font-bold uppercase text-[11px] tracking-[0.18em]">Front-Desk-Agent</h2>
              </div>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="name" className="block text-[10px] text-ink/45 font-bold uppercase tracking-[0.14em] mb-1.5">Patient Name</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                      <User className="h-4 w-4 text-sage" />
                    </div>
                    <input
                      id="name"
                      type="text"
                      required
                      value={patientName}
                      onChange={e => setPatientName(e.target.value)}
                      className="field block pl-10 pr-3 py-2.5 text-sm"
                      placeholder="Elias Thorne"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="symptoms" className="block text-[10px] text-ink/45 font-bold uppercase tracking-[0.14em] mb-1.5">Symptoms</label>
                  <textarea
                    id="symptoms"
                    required
                    rows={4}
                    value={symptoms}
                    onChange={e => setSymptoms(e.target.value)}
                    className="field block p-3 text-sm resize-none"
                    placeholder="e.g. Mild diarrhea and stomach cramps since yesterday..."
                  />
                </div>

                <div>
                  <label htmlFor="location" className="block text-[10px] text-ink/45 font-bold uppercase tracking-[0.14em] mb-1.5">Precise Location (Optional)</label>
                  <LocationInput value={location} onChange={setLocation} />
                </div>

                <div className="pt-1">
                  <button
                    disabled={isLoading}
                    type="submit"
                    className="group w-full flex justify-center items-center gap-2 py-3 px-4 rounded-xl text-sm font-bold text-canvas bg-pine hover:bg-pine-deep focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-pine/40 focus:ring-offset-[#fffdf8] transition-all disabled:opacity-70 disabled:cursor-not-allowed uppercase tracking-[0.12em] shadow-[0_16px_30px_-16px_rgba(15,76,69,0.9)]"
                  >
                    {isLoading ? 'Processing…' : 'Begin Consultation'}
                    {!isLoading && <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />}
                  </button>
                </div>
              </form>
            </div>
            
            {/* Agent Status Visualization */}
             <AnimatePresence>
               {isLoading && (
                 <motion.div 
                   initial={{ opacity: 0, height: 0 }}
                   animate={{ opacity: 1, height: 'auto' }}
                   exit={{ opacity: 0, height: 0 }}
                   className="mt-6 rounded-3xl p-6 shadow-[0_30px_60px_-30px_rgba(10,57,52,0.9)] overflow-hidden bg-pine-deep border border-white/5"
                 >
                    <h3 className="text-mist/60 text-[11px] font-mono mb-5 uppercase tracking-[0.18em] flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse"></span> System Operations
                    </h3>
                    <div className="space-y-4">
                       <AgentStatusItem 
                         name="Front Desk Agent" 
                         icon={<Bot className="w-4 h-4" />} 
                         isActive={activeAgent === 'front-desk'} 
                         isDone={['clinic-seeker', 'pharmacy-guide', 'risk-assessment', 'follow-up', 'synthesizing'].includes(activeAgent as string)}
                         desc="Registering patient & analyzing history."
                       />
                       <AgentStatusItem 
                         name="Clinic Seeker" 
                         icon={<Stethoscope className="w-4 h-4" />} 
                         isActive={activeAgent === 'clinic-seeker'}
                         isDone={['pharmacy-guide', 'risk-assessment', 'follow-up', 'synthesizing'].includes(activeAgent as string)}
                         desc="Locating nearby open medical facilities."
                       />
                       <AgentStatusItem
                         name="Pharmacy Guide"
                         icon={<Pill className="w-4 h-4" />}
                         isActive={activeAgent === 'pharmacy-guide'}
                         isDone={['risk-assessment', 'follow-up', 'synthesizing'].includes(activeAgent as string)}
                         desc="Determining OTC meds & dietary limits."
                       />
                       <AgentStatusItem
                         name="Risk Assessment"
                         icon={<ShieldAlert className="w-4 h-4" />}
                         isActive={activeAgent === 'risk-assessment'}
                         isDone={['follow-up', 'synthesizing'].includes(activeAgent as string)}
                         desc="Evaluating symptom severity level."
                       />
                       <AgentStatusItem
                         name="Follow-Up Agent"
                         icon={<ClipboardList className="w-4 h-4" />}
                         isActive={activeAgent === 'follow-up'}
                         isDone={activeAgent === 'synthesizing'}
                         desc="Generating post-consultation care plan."
                       />
                       <AgentStatusItem 
                         name="Synthesizer" 
                         icon={<Activity className="w-4 h-4" />} 
                         isActive={activeAgent === 'synthesizing'}
                         isDone={false} 
                         desc="Compiling final structured recommendation."
                       />
                    </div>
                 </motion.div>
               )}
             </AnimatePresence>

             {error && (
                <div className="mt-5 p-4 text-sm text-clay bg-clay/8 rounded-2xl border border-clay/20 flex items-start">
                  <ShieldAlert className="w-5 h-5 mr-2 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
             )}
          </div>

          {/* Results Column */}
          <div className="col-span-1 md:col-span-8">
            <AnimatePresence>
              {result && !isLoading && (
                <motion.div 
                   initial={{ opacity: 0, y: 20 }}
                   animate={{ opacity: 1, y: 0 }}
                   className="space-y-6"
                >
                  <div className="relative overflow-hidden rounded-3xl p-6 text-canvas shadow-[0_30px_60px_-32px_rgba(10,57,52,0.9)] bg-pine">
                    <div className="absolute -top-16 -right-10 w-48 h-48 rounded-full bg-pine-soft/40 blur-3xl pointer-events-none"></div>
                    <p className="relative text-[10px] font-bold uppercase tracking-[0.2em] text-mist/70 mb-3 flex items-center gap-2">
                      <Activity className="w-3.5 h-3.5" /> Agent Synthesis
                    </p>
                    <p className="relative font-display text-xl sm:text-2xl font-medium leading-snug">
                       {result.conclusion}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="rounded-2xl p-5 border border-gold/25 bg-gold/8 shadow-sm">
                      <div className="flex items-center gap-2 mb-2 text-gold">
                        <ShieldAlert className="w-5 h-5" />
                        <h4 className="font-bold uppercase text-[11px] tracking-[0.16em]">Risk Assessment</h4>
                      </div>
                      <p className="text-sm text-ink/80 font-medium leading-relaxed">{result.severity_assessment}</p>
                    </div>

                    <div className="rounded-2xl p-5 border border-pine/15 bg-mist shadow-sm">
                      <div className="flex items-center gap-2 mb-2 text-pine">
                        <ClipboardList className="w-5 h-5" />
                        <h4 className="font-bold uppercase text-[11px] tracking-[0.16em]">Follow-Up Care Plan</h4>
                      </div>
                      <p className="text-sm text-ink/80 leading-relaxed">{result.follow_up_plan}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative">
                    
                    {/* OTC Meds */}
                    <div className="surface rounded-2xl p-5">
                      <div className="flex items-center gap-2 mb-4 text-pine-soft border-b border-ink/8 pb-3">
                        <Pill className="w-5 h-5" />
                        <h4 className="font-bold uppercase text-[11px] tracking-[0.16em]">Pharmacy Guide</h4>
                      </div>
                      <div className="mt-2">
                        <h3 className="text-[10px] font-bold text-ink/45 mb-2 uppercase tracking-[0.12em]">OTC Medications</h3>
                        <p className="text-ink/75 text-sm leading-relaxed">{result.OTC_medication_recommended}</p>
                      </div>
                    </div>

                    {/* Clinic */}
                    <div className="surface rounded-2xl p-5 md:col-span-2">
                      <div className="flex items-center gap-2 mb-4 text-clay border-b border-ink/8 pb-3">
                        <Stethoscope className="w-5 h-5" />
                        <h4 className="font-bold uppercase text-[11px] tracking-[0.16em]">Clinic Seeker</h4>
                      </div>
                      <div className="mt-2">
                         <h3 className="text-[10px] font-bold text-ink/45 mb-2 uppercase tracking-[0.12em]">Recommended Facility</h3>
                         <div className="border-l-[3px] border-clay bg-clay/8 p-3 rounded-r-xl">
                           <p className="text-sm text-ink font-medium">{result.recommended_clinic}</p>
                         </div>
                         <ClinicMap clinicName={result.recommended_clinic} location={consultLocation} />
                      </div>
                    </div>

                    {/* Diet - Food */}
                    <div className="surface rounded-2xl p-5">
                      <div className="flex items-center gap-2 mb-4 text-pine border-b border-ink/8 pb-3">
                        <Apple className="w-5 h-5" />
                        <h4 className="font-bold uppercase text-[11px] tracking-[0.16em]">Food Guidance</h4>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                         <div className="bg-pine/6 p-3 rounded-xl border border-pine/15 flex flex-col justify-between">
                            <p className="text-[9px] font-black text-pine uppercase tracking-wide mb-1">Allowed</p>
                            <p className="text-xs text-ink/80 leading-relaxed font-medium">{result.food_recommended}</p>
                         </div>
                         <div className="bg-clay/8 p-3 rounded-xl border border-clay/20 flex flex-col justify-between">
                            <p className="text-[9px] font-black text-clay uppercase tracking-wide mb-1">Avoid</p>
                            <p className="text-xs text-ink/80 leading-relaxed font-medium">{result.food_restricted}</p>
                         </div>
                      </div>
                    </div>

                    {/* Diet - Drinks */}
                    <div className="surface rounded-2xl p-5">
                      <div className="flex items-center gap-2 mb-4 text-pine-soft border-b border-ink/8 pb-3">
                        <Coffee className="w-5 h-5" />
                        <h4 className="font-bold uppercase text-[11px] tracking-[0.16em]">Drink Guidance</h4>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                         <div className="bg-pine/6 p-3 rounded-xl border border-pine/15 flex flex-col justify-between">
                            <p className="text-[9px] font-black text-pine uppercase tracking-wide mb-1">Allowed</p>
                            <p className="text-xs text-ink/80 leading-relaxed font-medium">{result.drink_recommended}</p>
                         </div>
                         <div className="bg-clay/8 p-3 rounded-xl border border-clay/20 flex flex-col justify-between">
                            <p className="text-[9px] font-black text-clay uppercase tracking-wide mb-1">Avoid</p>
                            <p className="text-xs text-ink/80 leading-relaxed font-medium">{result.drink_restricted}</p>
                         </div>
                      </div>
                    </div>

                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  );
}

function ClinicMap({ clinicName, location }: { clinicName: string; location: string }) {
  const [place, setPlace] = useState<ClinicPlace | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'empty' | 'error'>('loading');

  useEffect(() => {
    if (!clinicName) return;
    const controller = new AbortController();

    (async () => {
      setStatus('loading');
      setPlace(null);
      try {
        const res = await fetch('/api/places/clinic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clinicName, location }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: { place: ClinicPlace | null } = await res.json();
        setPlace(data.place);
        setStatus(data.place ? 'ok' : 'empty');
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.error('[ClinicMap] clinic lookup error:', err);
        setStatus('error');
      }
    })();

    return () => controller.abort();
  }, [clinicName, location]);

  if (status === 'loading') {
    return (
      <div className="mt-3 h-[260px] w-full rounded-xl bg-pine/5 border border-ink/10 animate-pulse flex items-center justify-center">
        <span className="text-xs text-sage flex items-center gap-2">
          <MapPin className="w-4 h-4" /> Locating facility on the map…
        </span>
      </div>
    );
  }

  if (status !== 'ok' || !place) {
    return (
      <div className="mt-3 p-3 rounded-xl bg-mist border border-ink/10 text-xs text-ink/55 flex items-center gap-2">
        <MapPin className="w-4 h-4 text-clay" />
        {status === 'empty'
          ? 'Could not pinpoint this facility on the map. Please search the clinic name in Google Maps.'
          : 'Map details are unavailable right now.'}
      </div>
    );
  }

  const { name, address, rating, userRatingCount: ratingCount, phone, openNow } = place;
  // Fall back to a keyless Google Maps search URL if Places didn't return one.
  const mapsUri =
    place.googleMapsUri ||
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.lat},${place.lng}`)}`;
  // Keyless OpenStreetMap embed centred on the clinic with a marker.
  const d = 0.006;
  const osmSrc =
    `https://www.openstreetmap.org/export/embed.html?layer=mapnik` +
    `&bbox=${place.lng - d},${place.lat - d},${place.lng + d},${place.lat + d}` +
    `&marker=${place.lat},${place.lng}`;

  return (
    <div className="mt-3 space-y-3">
      <div className="h-[260px] w-full rounded-xl overflow-hidden border border-ink/10 shadow-sm">
        <iframe
          title={`Map showing ${name}`}
          src={osmSrc}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="w-full h-full border-0"
        />
      </div>

      {/* Place details panel */}
      <div className="rounded-xl border border-ink/10 bg-mist/60 p-3.5 space-y-2">
        <p className="text-sm font-semibold text-ink flex items-start gap-1.5">
          <MapPin className="w-4 h-4 text-clay shrink-0 mt-0.5" /> {name}
        </p>
        {address && (
          <p className="text-xs text-ink/65 leading-relaxed pl-5.5 ml-0.5">{address}</p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink/70 pt-0.5">
          {typeof rating === 'number' && (
            <span className="flex items-center gap-1 font-medium">
              <Star className="w-3.5 h-3.5 fill-current text-amber-500" /> {rating.toFixed(1)}
              {typeof ratingCount === 'number' && (
                <span className="text-ink/45 font-normal">({ratingCount})</span>
              )}
            </span>
          )}
          {typeof openNow === 'boolean' && (
            <span className={`flex items-center gap-1 font-semibold ${openNow ? 'text-pine-soft' : 'text-clay'}`}>
              <Clock className="w-3.5 h-3.5" /> {openNow ? 'Open now' : 'Closed'}
            </span>
          )}
          {phone && (
            <a href={`tel:${phone}`} className="flex items-center gap-1 text-pine hover:underline font-medium">
              <Phone className="w-3.5 h-3.5" /> {phone}
            </a>
          )}
          <a
            href={mapsUri}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-pine hover:underline font-medium"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Open in Google Maps
          </a>
        </div>
      </div>
    </div>
  );
}

function AgentStatusItem({ name, icon, isActive, isDone, desc }: { name: string, icon: React.ReactNode, isActive: boolean, isDone: boolean, desc: string }) {
   return (
      <div className={`flex items-start space-x-3 transition-opacity duration-300 ${isActive ? 'opacity-100' : isDone ? 'opacity-60' : 'opacity-35'}`}>
         <div className={`shrink-0 mt-0.5 w-7 h-7 rounded-full flex items-center justify-center transition-colors ${isActive ? 'bg-gold text-pine-deep animate-pulse' : isDone ? 'bg-pine-soft text-canvas' : 'bg-white/8 text-mist/60'}`}>
            {isDone ? <ChevronRight className="w-4 h-4" /> : icon}
         </div>
         <div>
            <div className={`text-sm font-semibold ${isActive ? 'text-gold' : isDone ? 'text-mist' : 'text-mist/70'}`}>
               {name}
            </div>
            <div className="text-xs text-mist/45 mt-0.5">{desc}</div>
         </div>
      </div>
   )
}

