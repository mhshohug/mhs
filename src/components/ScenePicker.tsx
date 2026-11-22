import { useState } from 'react';
import {
  Anchor,
  Building2,
  Bus,
  Calendar,
  Compass,
  Droplets,
  Home,
  Leaf,
  Mountain,
  RotateCcw,
  Sun,
  TrainFront,
  Trees,
  Waves,
  X,
} from 'lucide-react';
import { SCENE_CATALOG, SceneId } from '../data/sceneCatalog';
import { BENGALI_MONTHS_BN, computeBengaliPhenology } from '../utils/bengaliCalendar';

interface ScenePickerProps {
  selectedScene: SceneId;
  onSelectScene: (sceneId: SceneId) => void;
  previewBengaliMonth: number | null;
  onChangePreviewMonth: (monthIndex: number | null) => void;
  now: Date;
}

const SEASON_FLORA_DESC_BN: Record<string, string> = {
  grishmo: 'কৃষ্ণচূড়া ফুল, গাছে আম-কাঁঠাল ও গ্রীষ্মের উষ্ণ রোদ',
  barsha: 'বর্ষার কদম ফুল, ঘন সবুজ লতাপাতা ও সতেজ অরণ্য',
  sharat: 'নদীর তীরে কাশফুল, সাদা মেঘ ও স্বচ্ছ আকাশ',
  hemonto: 'মাঠে সোনালি ধান, ভোরের শিশির ও মিষ্টি রোদ',
  sheet: 'শীতের পাতা ঝরা ডাল, হলুদ সর্ষে ফুল ও হিমেল কুয়াশা',
  basanta: 'নতুন কচি পাতা, শিমুল-পলাশের লাল ও ঝরা পাপড়ি',
};

function renderSceneIcon(id: SceneId, className = 'h-4 w-4') {
  switch (id) {
    case 'forest':
      return <Trees className={className} />;
    case 'village':
      return <Home className={className} />;
    case 'city':
      return <Building2 className={className} />;
    case 'river':
      return <Waves className={className} />;
    case 'sea':
      return <Anchor className={className} />;
    case 'mountain':
      return <Mountain className={className} />;
    case 'train':
      return <TrainFront className={className} />;
    case 'bus':
      return <Bus className={className} />;
    case 'rooftop':
      return <Sun className={className} />;
    case 'haor':
      return <Droplets className={className} />;
    case 'teagarden':
      return <Leaf className={className} />;
    case 'railbridge':
      return <Compass className={className} />;
  }
}

export function ScenePicker({
  selectedScene,
  onSelectScene,
  previewBengaliMonth,
  onChangePreviewMonth,
  now,
}: ScenePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const calendarState = computeBengaliPhenology(now, previewBengaliMonth);
  const currentSceneItem =
    SCENE_CATALOG.find((item) => item.id === selectedScene) ?? SCENE_CATALOG[0];

  const handleChooseScene = (id: SceneId) => {
    onSelectScene(id);
    setIsOpen(false);
  };

  return (
    <>
      {/* Bottom-left Compact Scene Switcher Trigger Button right beside Chirkut icon */}
      <div className="fixed bottom-2.5 left-14 z-40 sm:bottom-4 sm:left-16">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          title={`দৃশ্যপট বদলান (${currentSceneItem.nameBn})`}
          aria-label={`দৃশ্যপট বদলান: ${currentSceneItem.nameBn}`}
          className={`group relative flex h-10 w-10 items-center justify-center rounded-xl border shadow-xl backdrop-blur-md transition-all focus-visible:outline-2 focus-visible:outline-emerald-300 ${
            selectedScene !== 'forest' || previewBengaliMonth !== null
              ? 'border-emerald-300/45 bg-[#0a1816]/90 text-emerald-200 hover:border-emerald-200/70 hover:bg-[#0f2420]'
              : 'border-white/15 bg-[#080c16]/88 text-emerald-200 hover:border-emerald-200/40 hover:bg-[#0d1424]'
          }`}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-300/15 text-emerald-200 transition-transform group-hover:scale-105">
            <Trees className="h-3.5 w-3.5" />
          </span>
        </button>
      </div>

      {/* Scrollable 12-Scene & Bengali Seasonal Picker Modal */}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="scene-picker-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-3 py-4 backdrop-blur-md sm:px-4"
          onClick={() => setIsOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[84dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#080d17] shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3.5 sm:px-5">
              <div className="min-w-0">
                <h2
                  id="scene-picker-title"
                  className="font-display text-base font-semibold tracking-tight text-slate-100 sm:text-lg"
                >
                  প্রকৃতি ও দৃশ্যপট বাছাই
                </h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  সব দৃশ্যেই লাইভ আবহাওয়া ও বাংলা বারো মাসের ঋতুচক্র একসাথে চলবে
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="বন্ধ করুন"
                className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-emerald-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Bengali Calendar & Interactive 12-Month Cycle Bar */}
            <div className="border-b border-white/10 bg-[#0b1322]/75 px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs text-emerald-200">
                  <Calendar className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                  <span className="font-semibold">{calendarState.formattedDateBn}</span>
                </div>
                <span className="text-[11px] text-slate-300">
                  {SEASON_FLORA_DESC_BN[calendarState.season]}
                </span>
              </div>

              <div
                aria-label="বাংলা মাস অনুযায়ী প্রকৃতি প্রিভিউ"
                className="mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-1"
              >
                <button
                  type="button"
                  onClick={() => onChangePreviewMonth(null)}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    previewBengaliMonth === null
                      ? 'border-emerald-300/60 bg-emerald-400/20 text-emerald-100'
                      : 'border-white/12 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>লাইভ দিন</span>
                </button>

                {BENGALI_MONTHS_BN.map((monthName, idx) => {
                  const isActiveMonth = previewBengaliMonth === idx;
                  const isCurrentRealMonth =
                    previewBengaliMonth === null && calendarState.monthIndex === idx;
                  return (
                    <button
                      key={monthName}
                      type="button"
                      onClick={() => onChangePreviewMonth(idx)}
                      className={`shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        isActiveMonth
                          ? 'border-amber-300/60 bg-amber-400/20 text-amber-100'
                          : isCurrentRealMonth
                            ? 'border-emerald-300/35 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20'
                            : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {monthName}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Scrollable 12-Scene Grid */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {SCENE_CATALOG.map((item) => {
                  const isSelected = selectedScene === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleChooseScene(item.id)}
                      className={`group flex items-center gap-3 rounded-xl border p-3 text-left transition-all focus-visible:outline-2 focus-visible:outline-emerald-300 ${
                        isSelected
                          ? 'border-emerald-300/65 bg-emerald-400/12 shadow-[0_0_20px_rgba(52,211,153,0.12)]'
                          : 'border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.07]'
                      }`}
                    >
                      {/* Mini Atmospheric Procedural Swatch */}
                      <div
                        className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/15 shadow-inner"
                        style={{
                          background: `linear-gradient(180deg, ${item.skySwatch} 0%, ${item.groundSwatch} 100%)`,
                        }}
                      >
                        <span
                          className="relative z-10 flex h-7 w-7 items-center justify-center rounded-md bg-black/30 backdrop-blur-[2px] transition-transform group-hover:scale-110"
                          style={{ color: item.accentHex }}
                        >
                          {renderSceneIcon(item.id, 'h-4 w-4')}
                        </span>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-slate-100">
                            {item.nameBn}
                          </span>
                          <span
                            className={`shrink-0 text-[10.5px] font-medium ${
                              isSelected ? 'text-emerald-300' : 'text-slate-400'
                            }`}
                          >
                            {isSelected ? 'চলছে' : item.categoryBn}
                          </span>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-slate-400">
                          {item.subtitleBn}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
