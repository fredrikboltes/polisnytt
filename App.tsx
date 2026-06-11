
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { fetchPoliceEvents } from './services/policeService';
import { generateNewsArticle } from './services/geminiService';
import { NewsArticle, FetchStatus } from './types';
import Header from './components/Header';
import ArticleCard from './components/ArticleCard';
import CountySelector from './components/CountySelector';

const POLL_INTERVAL = 10 * 60 * 1000; // 10 minutes

const App: React.FC = () => {
  const [selectedCounty, setSelectedCounty] = useState<string | null>(null);
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [processedEventIds, setProcessedEventIds] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState<FetchStatus>(FetchStatus.IDLE);
  const [nextUpdate, setNextUpdate] = useState<number>(POLL_INTERVAL);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const timerRef = useRef<number | null>(null);

  const updateArticles = useCallback(async (countyOverride?: string) => {
    const county = countyOverride || selectedCounty;
    if (!county) return;

    setStatus(FetchStatus.LOADING);
    setErrorMsg(null);
    
    try {
      // Fetch only for the selected county
      const events = await fetchPoliceEvents(county);
      
      if (events.length === 0) {
        setStatus(FetchStatus.SUCCESS);
        // If it's a fresh county selection and no events found
        if (articles.length === 0) {
          // Keep success but empty
        }
        return;
      }

      // Filter for new events only
      const newEvents = events.filter(e => !processedEventIds.has(e.id));
      
      if (newEvents.length > 0) {
        const generatedArticles: NewsArticle[] = [];
        const eventsToProcess = newEvents.slice(0, 5);

        for (const event of eventsToProcess) {
          const article = await generateNewsArticle(event);
          if (article) {
            generatedArticles.push(article);
          }
        }

        if (generatedArticles.length === 0) {
          throw new Error('Failed to generate articles for fetched police events.');
        }

        setArticles(prev => {
          const combined = [...generatedArticles, ...prev];
          return combined.sort((a, b) => 
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          );
        });
        setProcessedEventIds(prev => {
          const next = new Set(prev);
          generatedArticles.forEach(article => next.add(article.originalEventId));
          return next;
        });
      }
      
      setStatus(FetchStatus.SUCCESS);
      setNextUpdate(POLL_INTERVAL);
    } catch (err) {
      console.error(err);
      setStatus(FetchStatus.ERROR);
      setErrorMsg("Ett fel uppstod vid hämtning av nyheter.");
    }
  }, [selectedCounty, processedEventIds, articles.length]);

  // Handle County Selection
  const handleCountySelect = (county: string) => {
    setSelectedCounty(county);
    setArticles([]); // Clear old articles
    setProcessedEventIds(new Set()); // Reset tracking
    setNextUpdate(POLL_INTERVAL);
    updateArticles(county);
  };

  const handleReset = () => {
    setSelectedCounty(null);
    setArticles([]);
    setProcessedEventIds(new Set());
  };

  // Setup Polling
  useEffect(() => {
    if (!selectedCounty) return;
    
    const interval = setInterval(() => {
      updateArticles();
    }, POLL_INTERVAL);

    // Countdown timer
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setNextUpdate(prev => Math.max(0, prev - 1000));
    }, 1000);

    return () => {
      clearInterval(interval);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [selectedCounty, updateArticles]);

  const formatTime = (ms: number) => {
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen pb-20">
      <Header 
        status={status} 
        countdown={formatTime(nextUpdate)} 
        articleCount={articles.length}
        onRefresh={() => updateArticles()}
        selectedCounty={selectedCounty}
        onReset={handleReset}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-12">
        {!selectedCounty ? (
          <CountySelector onSelect={handleCountySelect} />
        ) : (
          <>
            {errorMsg && (
              <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-8 rounded-r-md">
                <p className="text-sm text-red-700">{errorMsg}</p>
              </div>
            )}

            <div className="mb-10">
              <h2 className="text-3xl font-black text-gray-900 serif">Senaste händelserna i {selectedCounty}</h2>
              <div className="h-1 w-20 bg-blue-900 mt-2"></div>
            </div>

            {articles.length === 0 && status === FetchStatus.LOADING ? (
              <div className="flex flex-col items-center justify-center py-24">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-900 mb-4"></div>
                <p className="text-gray-500 text-lg">Skriver artiklar för {selectedCounty}...</p>
              </div>
            ) : articles.length === 0 && status === FetchStatus.SUCCESS ? (
              <div className="text-center py-24 bg-white rounded-2xl border border-dashed border-gray-300">
                <p className="text-gray-400 text-xl serif italic">Inga rapporterade händelser i {selectedCounty} just nu.</p>
                <button onClick={handleReset} className="mt-4 text-blue-900 font-bold hover:underline">Välj ett annat län</button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
                {articles.map((article, index) => (
                  <ArticleCard 
                    key={article.id} 
                    article={article} 
                    isFeatured={index === 0}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      <footer className="mt-20 py-10 border-t border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 text-center text-gray-400 text-sm">
          <p>© {new Date().getFullYear()} Svenska Polisnyheter AI</p>
          <p className="mt-1 italic">Nyheter verifierade genom Polisens Öppna Data</p>
        </div>
      </footer>
    </div>
  );
};

export default App;
