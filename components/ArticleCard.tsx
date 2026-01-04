
import React, { useState } from 'react';
import { NewsArticle } from '../types';

interface ArticleCardProps {
  article: NewsArticle;
  isFeatured: boolean;
}

const ArticleCard: React.FC<ArticleCardProps> = ({ article, isFeatured }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const formattedDate = new Date(article.timestamp).toLocaleString('sv-SE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  if (isFeatured) {
    return (
      <div className="col-span-1 md:col-span-2 lg:col-span-3 bg-white rounded-xl shadow-lg overflow-hidden border border-gray-100 group">
        <div className="flex flex-col lg:flex-row">
          <div className="lg:w-3/5 relative h-64 lg:h-auto overflow-hidden">
             <img 
               src={article.imageUrl} 
               alt={article.title} 
               className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
             />
             <div className="absolute top-4 left-4">
               <span className="bg-blue-900 text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded">Huvudnyhet</span>
             </div>
          </div>
          <div className="lg:w-2/5 p-8 flex flex-col justify-center">
            <div className="flex items-center space-x-2 text-blue-600 text-xs font-bold uppercase tracking-widest mb-4">
              <span>{article.category}</span>
              <span>•</span>
              <span>{article.location}</span>
            </div>
            <h2 className="text-3xl lg:text-4xl font-black text-gray-900 leading-tight mb-4">{article.title}</h2>
            <p className="text-gray-600 text-lg font-medium leading-relaxed mb-6">
              {article.lead}
            </p>
            <div className="flex items-center justify-between mt-auto">
              <span className="text-gray-400 text-xs font-semibold uppercase">{formattedDate}</span>
              <button 
                onClick={() => setIsExpanded(!isExpanded)}
                className="text-blue-900 font-bold text-sm uppercase border-b-2 border-blue-900 pb-0.5 hover:text-blue-700 hover:border-blue-700 transition-colors"
              >
                {isExpanded ? 'Visa mindre' : 'Läs hela artikeln'}
              </button>
            </div>
          </div>
        </div>
        {isExpanded && (
          <div className="p-8 border-t border-gray-100 bg-gray-50 animate-fadeIn">
            <div className="max-w-3xl prose prose-blue prose-lg text-gray-700 leading-relaxed whitespace-pre-line">
              {article.body}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col group h-full">
      <div className="relative h-48 overflow-hidden">
        <img 
          src={article.imageUrl} 
          alt={article.title} 
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute top-4 left-4">
          <span className="bg-white/90 backdrop-blur-sm text-gray-900 text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded shadow-sm border border-gray-200">
            {article.category}
          </span>
        </div>
      </div>
      <div className="p-6 flex flex-col flex-grow">
        <div className="flex items-center text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
          <span>{article.location}</span>
          <span className="mx-2">•</span>
          <span>{formattedDate}</span>
        </div>
        <h3 className="text-xl font-bold text-gray-900 leading-snug mb-3 line-clamp-2">{article.title}</h3>
        <p className="text-gray-500 text-sm leading-relaxed mb-6 line-clamp-3">
          {article.lead}
        </p>
        <div className="mt-auto">
          <button 
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full py-2 bg-gray-50 text-blue-900 text-xs font-bold uppercase tracking-widest rounded hover:bg-blue-900 hover:text-white transition-all border border-gray-100"
          >
            {isExpanded ? 'Visa mindre' : 'Läs artikel'}
          </button>
        </div>
      </div>
      {isExpanded && (
        <div className="p-6 border-t border-gray-100 bg-gray-50 animate-fadeIn text-sm text-gray-600 leading-relaxed whitespace-pre-line">
          {article.body}
        </div>
      )}
    </div>
  );
};

export default ArticleCard;
