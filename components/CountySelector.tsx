
import React from 'react';
import { COUNTIES } from '../types';

interface CountySelectorProps {
  onSelect: (county: string) => void;
}

const CountySelector: React.FC<CountySelectorProps> = ({ onSelect }) => {
  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <div className="text-center mb-12">
        <h2 className="text-4xl sm:text-5xl font-black text-blue-900 mb-4 tracking-tight">Välj ditt län</h2>
        <p className="text-gray-500 text-lg max-w-2xl mx-auto">
          För att se de senaste lokala nyheterna från Polisen, vänligen välj det område du är intresserad av.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
        {/* List side */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {COUNTIES.sort().map((county) => (
            <button
              key={county}
              onClick={() => onSelect(county)}
              className="px-4 py-3 text-left bg-white border border-gray-200 rounded-lg shadow-sm hover:border-blue-500 hover:bg-blue-50 transition-all group"
            >
              <span className="text-sm font-semibold text-gray-700 group-hover:text-blue-900">{county}</span>
            </button>
          ))}
        </div>

        {/* Visual Map Side (Simplified SVG Representation) */}
        <div className="bg-blue-50 rounded-3xl p-8 flex justify-center items-center relative overflow-hidden min-h-[500px]">
          <div className="absolute inset-0 opacity-10 pointer-events-none">
             <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_50%,#1e3a8a_0%,transparent_70%)]"></div>
          </div>
          
          <div className="relative z-10 w-full max-w-xs transform hover:scale-105 transition-transform duration-700">
            <svg viewBox="0 0 400 800" className="w-full h-auto drop-shadow-2xl">
              {/* This is a stylized representation of Sweden */}
              <path 
                d="M180,50 L220,40 L240,60 L260,100 L280,180 L290,250 L300,320 L290,400 L270,500 L250,580 L230,650 L210,720 L180,750 L140,760 L120,740 L110,680 L125,600 L140,500 L130,400 L120,300 L140,200 L160,100 Z" 
                fill="#1e3a8a" 
                stroke="#fff" 
                strokeWidth="2"
              />
              <circle cx="210" cy="720" r="8" fill="#fbbf24" className="animate-pulse" /> {/* Skåne area */}
              <circle cx="280" cy="550" r="8" fill="#fbbf24" className="animate-pulse" style={{animationDelay: '1s'}} /> {/* Stockholm area */}
              <circle cx="210" cy="150" r="8" fill="#fbbf24" className="animate-pulse" style={{animationDelay: '2s'}} /> {/* Norrland area */}
            </svg>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
              <p className="text-white text-xs font-bold uppercase tracking-widest opacity-40">Sverige</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CountySelector;
