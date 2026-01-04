
import React from 'react';
import { FetchStatus } from '../types';

interface HeaderProps {
  status: FetchStatus;
  countdown: string;
  articleCount: number;
  onRefresh: () => void;
  selectedCounty: string | null;
  onReset: () => void;
}

const Header: React.FC<HeaderProps> = ({ status, countdown, articleCount, onRefresh, selectedCounty, onReset }) => {
  return (
    <nav className="bg-white shadow-sm sticky top-0 z-50 border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-20">
          <div className="flex-shrink-0 flex items-center cursor-pointer" onClick={onReset}>
            <div className="bg-blue-900 text-white p-2 rounded-md mr-3 hidden sm:block">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9.5a2.5 2.5 0 00-2.5-2.5H15M9 11l3 3m0 0l3-3m-3 3V8" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-blue-900 tracking-tighter uppercase">Polisnyheter</h1>
              {selectedCounty && (
                <div className="flex items-center text-blue-600 font-bold text-[10px] uppercase tracking-widest">
                   <span>{selectedCounty}</span>
                   <button onClick={(e) => { e.stopPropagation(); onReset(); }} className="ml-2 underline hover:text-blue-800">Byt län</button>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-4">
            {selectedCounty && (
              <div className="text-right hidden md:block">
                <div className="flex items-center text-xs font-bold text-gray-400 uppercase tracking-wider">
                  <div className={`w-2 h-2 rounded-full mr-2 ${status === FetchStatus.LOADING ? 'bg-yellow-400 animate-pulse' : 'bg-green-500'}`}></div>
                  Uppdateras om: {countdown}
                </div>
              </div>
            )}

            {selectedCounty && (
              <button 
                onClick={onRefresh}
                disabled={status === FetchStatus.LOADING}
                className="p-2 rounded-full text-gray-500 hover:bg-gray-100 transition-colors disabled:opacity-50"
                title="Uppdatera nu"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className={`h-6 w-6 ${status === FetchStatus.LOADING ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Header;
