import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bot, User, Stethoscope, Pill, Locate, Coffee, ShieldAlert, ChevronRight, Apple, Activity, Key, ClipboardList } from 'lucide-react';
import { MedicalAdvice } from './types.ts';
import { motion, AnimatePresence } from 'motion/react';
import { APIProvider, useMapsLibrary } from '@vis.gl/react-google-maps';

const API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  '';
const hasValidKey = Boolean(API_KEY) && API_KEY !== 'YOUR_API_KEY';

function LocationInput({ value, onChange }: { value: string, onChange: (val: string) => void }) {
  const placesLib = useMapsLibrary('places');
  const autocompleteRef = useRef<any>(null);

  // Use a stable selector function
  const handleSelect = useCallback(async (e: any) => {
    console.log('[LocationInput] Select event received:', e);
    // Fallback chain for different event structures
    const placePrediction = e.placePrediction || e.detail?.placePrediction || e.target?.placePrediction || e.prediction || e.detail?.prediction;
    
    if (placePrediction) {
      try {
        console.log('[LocationInput] Converting prediction to place...');
        const place = await placePrediction.toPlace();
        await place.fetchFields({ fields: ['formattedAddress', 'displayName'] });
        
        const displayText = place.formattedAddress || place.displayName?.text || '';
        console.log('[LocationInput] Selection successful:', displayText);
        onChange(displayText);
      } catch (err) {
        console.error('[LocationInput] Place fetch error:', err);
      }
    } else {
      console.warn('[LocationInput] No placePrediction found. Event details:', {
        hasDetail: !!e.detail,
        hasTarget: !!e.target,
        detailKeys: e.detail ? Object.keys(e.detail) : [],
        targetKeys: e.target ? Object.keys(e.target) : []
      });
      
      // Attempt emergency fallback if the component itself has the value
      if (e.target && 'placePrediction' in e.target) {
         try {
            const fallbackPrediction = (e.target as any).placePrediction;
            if (fallbackPrediction) {
              const place = await fallbackPrediction.toPlace();
              await place.fetchFields({ fields: ['formattedAddress', 'displayName'] });
              onChange(place.formattedAddress || place.displayName?.text || '');
              return;
            }
         } catch (fallbackErr) {
            console.error('[LocationInput] Fallback resolution failed:', fallbackErr);
         }
      }
    }
  }, [onChange]);

  useEffect(() => {
    const el = autocompleteRef.current;
    if (!el || !placesLib) return;

    // Add multiple possible event listeners for cross-version compatibility
    el.addEventListener('gmp-select', handleSelect);
    el.addEventListener('gmp-placeselect', handleSelect);
    el.addEventListener('gmp-select-place', handleSelect);
    
    return () => {
      el.removeEventListener('gmp-select', handleSelect);
      el.removeEventListener('gmp-placeselect', handleSelect);
      el.removeEventListener('gmp-select-place', handleSelect);
    };
  }, [placesLib, handleSelect]);

  if (!placesLib) {
    return <div className="h-10 w-full bg-slate-50 animate-pulse rounded-lg border border-slate-100" />;
  }

  return (
    <div className="relative medical-location-input min-h-[42px] z-[60]">
      {/* 
          Using the custom element. 
          Note: We use ref to attach events because React doesn't always bind gmp-* events correctly.
      */}
      <gmp-basic-place-autocomplete 
        ref={autocompleteRef}
        style={{ width: '100%', display: 'block' }}
      />
      <style>{`
        gmp-basic-place-autocomplete::part(input) {
          width: 100%;
          padding: 0.6rem 0.75rem 0.6rem 2.25rem;
          border: 1px solid #e2e8f0;
          border-radius: 0.5rem;
          font-size: 0.875rem;
          background-color: #ffffff;
          transition: all 0.2s;
          box-sizing: border-box;
        }
        gmp-basic-place-autocomplete::part(input):focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
          outline: none;
        }
        .medical-location-input::before {
          content: '';
          position: absolute;
          left: 0.75rem;
          top: 50%;
          transform: translateY(-50%);
          width: 1rem;
          height: 1rem;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z'%3E%3C/path%3E%3Ccircle cx='12' cy='10' r='3'%3E%3C/circle%3E%3C/svg%3E");
          background-size: contain;
          background-repeat: no-repeat;
          z-index: 100;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}

export default function App() {
  if (!hasValidKey) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans text-slate-800">
        <div className="bg-white max-w-lg w-full rounded-2xl shadow-sm border border-slate-200 p-8">
          <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center mb-6">
            <Key size={24} />
          </div>
          <h2 className="text-2xl font-bold font-display text-slate-900 mb-2">Google Maps API Key Required</h2>
          <p className="text-slate-500 mb-6 leading-relaxed">
            To enable precise location features, this application requires a Google Maps Platform API key.
          </p>
          <div className="space-y-4">
            <p className="text-sm"><strong>Step 1:</strong> <a href="https://console.cloud.google.com/google/maps-apis/start?utm_campaign=gmp-code-assist-ais" target="_blank" rel="noopener" className="text-blue-600 hover:underline">Get an API Key</a></p>
            <div>
              <p className="text-sm font-bold mb-2">Step 2: Add your key as a secret:</p>
              <ul className="text-sm text-slate-600 space-y-2 list-disc pl-5">
                <li>Open <strong>Settings</strong> (⚙️ gear icon, <strong>top-right corner</strong>)</li>
                <li>Select <strong>Secrets</strong></li>
                <li>Type <code>GOOGLE_MAPS_PLATFORM_KEY</code> as the secret name, press <strong>Enter</strong></li>
                <li>Paste your API key as the value, press <strong>Enter</strong></li>
              </ul>
            </div>
            <p className="text-sm text-slate-500 italic mt-4">The app will rebuild automatically.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <APIProvider apiKey={API_KEY} version="weekly">
      <MainApp />
    </APIProvider>
  );
}

function MainApp() {
  const [patientName, setPatientName] = useState('');
  const [symptoms, setSymptoms] = useState('');
  const [location, setLocation] = useState('');
  
  const [isLoading, setIsLoading] = useState(false);
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  const [result, setResult] = useState<MedicalAdvice | null>(null);
  const [error, setError] = useState<string | null>(null);

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

      // Actual fetch
      const response = await fetch('/api/consult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientName, symptoms, location }),
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
    <div className="min-h-screen bg-slate-100 text-slate-800 selection:bg-blue-100 selection:text-blue-900 font-sans pb-20">
      {/* Header */}
      <header className="max-w-6xl mx-auto px-4 pt-6">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex items-center justify-between">
          <div className="flex items-center space-x-4">
             <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold">
                <Activity size={20} />
             </div>
             <div>
                <h1 className="text-xl font-bold font-display tracking-tight text-slate-800">HealthAgent AI</h1>
                <p className="text-xs text-slate-500 font-medium uppercase tracking-widest">Multi-Agent Diagnostic Suite</p>
             </div>
          </div>
          <div className="hidden sm:flex items-center gap-6">
            <div className="text-right">
              <p className="text-xs text-slate-400 uppercase font-bold">System Status</p>
              <p className="text-sm text-emerald-500 font-semibold flex items-center gap-1">
                <span className="w-2 h-2 bg-emerald-500 rounded-full inline-block"></span> Active
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 mt-8">
        
        {/* Intro Section */}
        {!result && !isLoading && (
          <div className="text-center mb-10 mt-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
             <h2 className="text-3xl sm:text-4xl font-bold font-display tracking-tight text-slate-900 mb-4">
                Your AI Medical Assistant
             </h2>
             <p className="text-slate-500 max-w-xl mx-auto text-lg">
                Describe your minor symptoms below. Our multi-agent system will quickly direct you to a nearby clinic, suggest OTC meds, and provide dietary guidance.
             </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
          
          {/* Form Column */}
          <div className={`col-span-1 md:col-span-${result || isLoading ? '4' : '12'} lg:col-span-${result || isLoading ? '4' : '8 lg:col-start-3'} transition-all duration-500`}>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <div className="flex items-center gap-2 mb-4 text-blue-700">
                <Bot className="w-5 h-5" />
                <h2 className="font-bold uppercase text-xs tracking-wider">Front-Desk-Agent</h2>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="name" className="block text-[10px] text-slate-400 font-bold uppercase mb-1">Patient Name</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <User className="h-4 w-4 text-slate-400" />
                    </div>
                    <input
                      id="name"
                      type="text"
                      required
                      value={patientName}
                      onChange={e => setPatientName(e.target.value)}
                      className="block w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-colors text-sm bg-slate-50"
                      placeholder="Elias Thorne"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="symptoms" className="block text-[10px] text-slate-400 font-bold uppercase mb-1">Symptoms</label>
                  <textarea
                    id="symptoms"
                    required
                    rows={4}
                    value={symptoms}
                    onChange={e => setSymptoms(e.target.value)}
                    className="block w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-colors text-sm bg-slate-50 resize-none"
                    placeholder="e.g. Mild diarrhea and stomach cramps since yesterday..."
                  />
                </div>

                <div>
                  <label htmlFor="location" className="block text-[10px] text-slate-400 font-bold uppercase mb-1">Precise Location (Optional)</label>
                  <LocationInput value={location} onChange={setLocation} />
                </div>

                <div className="pt-2">
                  <button
                    disabled={isLoading}
                    type="submit"
                    className="w-full flex justify-center items-center py-2.5 px-4 rounded-lg shadow-sm text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all disabled:opacity-70 disabled:cursor-not-allowed uppercase tracking-wider"
                  >
                    {isLoading ? 'Processing...' : 'Start Extraction'}
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
                   className="mt-6 bg-slate-800 rounded-xl p-5 shadow-lg overflow-hidden"
                 >
                    <h3 className="text-slate-400 text-xs font-mono mb-4 uppercase tracking-wider">System Operations</h3>
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
                <div className="mt-4 p-4 text-sm text-red-800 bg-red-100 rounded-xl border border-red-200 flex items-start">
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
                  <div className="bg-blue-900 rounded-xl p-5 text-white shadow-lg mb-6">
                    <p className="text-[10px] font-bold uppercase opacity-60 mb-2">Agent Synthesis</p>
                    <p className="text-sm font-light leading-relaxed">
                       {result.conclusion}
                    </p>
                  </div>

                  <div className="bg-amber-50 rounded-xl p-5 border border-amber-200 shadow-sm mb-6">
                    <div className="flex items-center gap-2 mb-2 text-amber-700">
                      <ShieldAlert className="w-5 h-5" />
                      <h4 className="font-bold uppercase text-xs tracking-wider">Risk Assessment</h4>
                    </div>
                    <p className="text-sm text-amber-900 font-medium">{result.severity_assessment}</p>
                  </div>

                  <div className="bg-teal-50 rounded-xl p-5 border border-teal-200 shadow-sm mb-6">
                    <div className="flex items-center gap-2 mb-2 text-teal-700">
                      <ClipboardList className="w-5 h-5" />
                      <h4 className="font-bold uppercase text-xs tracking-wider">Follow-Up Care Plan</h4>
                    </div>
                    <p className="text-sm text-teal-900 leading-relaxed">{result.follow_up_plan}</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative">
                    
                    {/* OTC Meds */}
                    <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
                      <div className="flex items-center gap-2 mb-4 text-indigo-700 border-b border-slate-100 pb-2">
                        <Pill className="w-5 h-5" />
                        <h4 className="font-bold uppercase text-xs tracking-wider">Pharmacy Guide</h4>
                      </div>
                      <div className="mt-2">
                        <h3 className="text-[10px] font-bold text-slate-500 mb-2 uppercase tracking-tight">OTC Medications</h3>
                        <p className="text-slate-700 text-sm leading-relaxed">{result.OTC_medication_recommended}</p>
                      </div>
                    </div>

                    {/* Clinic */}
                    <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
                      <div className="flex items-center gap-2 mb-4 text-orange-600 border-b border-slate-100 pb-2">
                        <Stethoscope className="w-5 h-5" />
                        <h4 className="font-bold uppercase text-xs tracking-wider">Clinic Seeker</h4>
                      </div>
                      <div className="mt-2">
                         <h3 className="text-[10px] font-bold text-slate-500 mb-2 uppercase tracking-tight">Recommended Facility</h3>
                         <div className="border-l-4 border-orange-500 bg-orange-50 p-3 rounded-r-lg">
                           <p className="text-sm text-slate-800 font-medium">{result.recommended_clinic}</p>
                         </div>
                      </div>
                    </div>

                    {/* Diet - Food */}
                    <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
                      <div className="flex items-center gap-2 mb-4 text-emerald-600 border-b border-slate-100 pb-2">
                        <Apple className="w-5 h-5" />
                        <h4 className="font-bold uppercase text-xs tracking-wider">Food Guidance</h4>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                         <div className="bg-emerald-50 p-3 rounded border border-emerald-100 flex flex-col justify-between">
                            <p className="text-[9px] font-black text-emerald-700 uppercase mb-1">Allowed</p>
                            <p className="text-xs text-emerald-900 leading-relaxed font-medium">{result.food_recommended}</p>
                         </div>
                         <div className="bg-red-50 p-3 rounded border border-red-100 flex flex-col justify-between">
                            <p className="text-[9px] font-black text-red-700 uppercase mb-1">Avoid</p>
                            <p className="text-xs text-red-900 leading-relaxed font-medium">{result.food_restricted}</p>
                         </div>
                      </div>
                    </div>

                    {/* Diet - Drinks */}
                    <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
                      <div className="flex items-center gap-2 mb-4 text-cyan-600 border-b border-slate-100 pb-2">
                        <Coffee className="w-5 h-5" />
                        <h4 className="font-bold uppercase text-xs tracking-wider">Drink Guidance</h4>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                         <div className="bg-emerald-50 p-3 rounded border border-emerald-100 flex flex-col justify-between">
                            <p className="text-[9px] font-black text-emerald-700 uppercase mb-1">Allowed</p>
                            <p className="text-xs text-emerald-900 leading-relaxed font-medium">{result.drink_recommended}</p>
                         </div>
                         <div className="bg-red-50 p-3 rounded border border-red-100 flex flex-col justify-between">
                            <p className="text-[9px] font-black text-red-700 uppercase mb-1">Avoid</p>
                            <p className="text-xs text-red-900 leading-relaxed font-medium">{result.drink_restricted}</p>
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

function AgentStatusItem({ name, icon, isActive, isDone, desc }: { name: string, icon: React.ReactNode, isActive: boolean, isDone: boolean, desc: string }) {
   return (
      <div className={`flex items-start space-x-3 transition-opacity duration-300 ${isActive ? 'opacity-100' : isDone ? 'opacity-50' : 'opacity-30'}`}>
         <div className={`shrink-0 mt-0.5 w-6 h-6 rounded-full flex items-center justify-center ${isActive ? 'bg-blue-500 text-white animate-pulse' : isDone ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-400'}`}>
            {isDone ? <ChevronRight className="w-4 h-4" /> : icon}
         </div>
         <div>
            <div className={`text-sm font-medium ${isActive ? 'text-blue-400' : isDone ? 'text-emerald-400' : 'text-slate-400'}`}>
               {name}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">{desc}</div>
         </div>
      </div>
   )
}

