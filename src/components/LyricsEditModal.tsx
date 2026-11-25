import React, { useState } from 'react';
import { Plus, Trash2, Save, X, Music2, Clock } from 'lucide-react';
import { parseTwoLineLyrics } from './SkySongLyrics';

export interface EditableLyricItem {
  id: string;
  startSec: number;
  endSec: number;
  original: string;
  translation: string;
}

interface LyricsEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  songTitle: string;
  initialLines: Array<{ startSec: number; endSec: number; text: string }>;
  onSave: (lines: Array<{ startSec: number; endSec: number; text: string }>) => Promise<void>;
}

export function LyricsEditModal({
  isOpen,
  onClose,
  songTitle,
  initialLines,
  onSave,
}: LyricsEditModalProps) {
  const [lines, setLines] = useState<EditableLyricItem[]>(() => {
    return initialLines.map((l, idx) => {
      const parsed = parseTwoLineLyrics(l.text);
      return {
        id: `line_${idx}_${Date.now()}`,
        startSec: Number(l.startSec.toFixed(1)),
        endSec: Number(l.endSec.toFixed(1)),
        original: parsed.original,
        translation: parsed.translation || '',
      };
    });
  });

  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAddLine = () => {
    const last = lines[lines.length - 1];
    const nextStart = last ? Number((last.endSec + 0.5).toFixed(1)) : 0;
    const nextEnd = Number((nextStart + 3.5).toFixed(1));
    setLines([
      ...lines,
      {
        id: `line_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        startSec: nextStart,
        endSec: nextEnd,
        original: '',
        translation: '',
      },
    ]);
  };

  const handleRemoveLine = (id: string) => {
    setLines(lines.filter((l) => l.id !== id));
  };

  const handleChange = (
    id: string,
    field: keyof Omit<EditableLyricItem, 'id'>,
    val: string | number
  ) => {
    setLines(
      lines.map((l) => {
        if (l.id !== id) return l;
        return { ...l, [field]: val };
      })
    );
  };

  const handleSave = async () => {
    setErrorText(null);
    const valid = lines
      .map((l) => {
        const orig = l.original.trim();
        const trans = l.translation.trim();
        const text = trans ? `${orig}\n${trans}` : orig;
        return {
          startSec: Math.max(0, Number(l.startSec) || 0),
          endSec: Math.max(Number(l.startSec) + 1, Number(l.endSec) || 0),
          text,
        };
      })
      .filter((l) => l.text.length > 0)
      .sort((a, b) => a.startSec - b.startSec);

    if (valid.length === 0) {
      setErrorText('কমপক্ষে একটি বৈধ লিরিক্স লাইন থাকতে হবে।');
      return;
    }

    setSaving(true);
    try {
      await onSave(valid);
      onClose();
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'সংরক্ষণ করতে সমস্যা হয়েছে।');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/80 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      {/* Modal Dialog */}
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-white/10 bg-slate-900/95 p-4 text-slate-100 shadow-2xl sm:p-6">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-300">
              <Music2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-amber-100 sm:text-lg">
                লিরিক্স সম্পাদনা
              </h2>
              <p className="line-clamp-1 text-xs text-slate-400">
                {songTitle || 'বর্তমান গান'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="বন্ধ করুন"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tip / instructions */}
        <div className="mt-3 rounded-lg border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
          💡 <span className="font-medium">দুই লাইনের নিয়ম:</span> প্রথম লাইনে বাংলা হরফে মূল উচ্চারণ (যেমন: <i>কাহাঁ হো তুম</i>) এবং দ্বিতীয় লাইনে তার বাংলা অর্থ (যেমন: <i>কোথায় আছো তুমি</i>) লিখুন।
        </div>

        {errorText && (
          <div className="mt-2 rounded-lg border border-rose-500/20 bg-rose-500/10 p-2.5 text-xs text-rose-300">
            {errorText}
          </div>
        )}

        {/* Scrollable list of lines */}
        <div className="mt-3 flex-1 space-y-3 overflow-y-auto pr-1">
          {lines.map((item, idx) => (
            <div
              key={item.id}
              className="group relative rounded-xl border border-white/10 bg-white/5 p-3 transition-colors hover:border-amber-400/30"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-2">
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-amber-300/90">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-400/20 text-[10px]">
                    {idx + 1}
                  </span>
                  লাইন #{idx + 1}
                </span>

                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Clock className="h-3.5 w-3.5 text-slate-400" />
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={item.startSec}
                      onChange={(e) =>
                        handleChange(item.id, 'startSec', parseFloat(e.target.value) || 0)
                      }
                      className="w-14 rounded bg-black/40 px-1.5 py-0.5 text-center text-xs text-amber-200 focus:outline-none focus:ring-1 focus:ring-amber-400"
                      title="শুরু (সেকেন্ড)"
                    />
                    <span>—</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={item.endSec}
                      onChange={(e) =>
                        handleChange(item.id, 'endSec', parseFloat(e.target.value) || 0)
                      }
                      className="w-14 rounded bg-black/40 px-1.5 py-0.5 text-center text-xs text-amber-200 focus:outline-none focus:ring-1 focus:ring-amber-400"
                      title="শেষ (সেকেন্ড)"
                    />
                    <span className="text-[10px] text-slate-500">সেকেন্ড</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRemoveLine(item.id)}
                    className="ml-2 rounded p-1 text-slate-500 hover:bg-rose-500/20 hover:text-rose-300"
                    title="এই লাইন মুছে ফেলুন"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="mt-2.5 space-y-2">
                <div>
                  <label className="block text-[11px] text-slate-400">
                    লাইন ১ (মূল উচ্চারণ - বাংলা হরফে):
                  </label>
                  <input
                    type="text"
                    value={item.original}
                    onChange={(e) => handleChange(item.id, 'original', e.target.value)}
                    placeholder="যেমন: কাহাঁ হো তুম"
                    className="mt-0.5 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-amber-100 placeholder-slate-600 focus:border-amber-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400">
                    লাইন ২ (বাংলা অর্থ / অনুবাদ):
                  </label>
                  <input
                    type="text"
                    value={item.translation}
                    onChange={(e) => handleChange(item.id, 'translation', e.target.value)}
                    placeholder="যেমন: কোথায় আছো তুমি (ঐচ্ছিক)"
                    className="mt-0.5 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-sky-100 placeholder-slate-600 focus:border-sky-400 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          ))}

          {lines.length === 0 && (
            <p className="py-6 text-center text-xs text-slate-500">
              কোনো লিরিক্স লাইন নেই। নিচের বাটন দিয়ে নতুন লাইন যোগ করুন।
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
          <button
            type="button"
            onClick={handleAddLine}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-white/20 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-amber-400/50 hover:bg-amber-400/10 hover:text-amber-200"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>নতুন লাইন যোগ করুন</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 hover:bg-white/10 hover:text-white"
            >
              বাতিল
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{saving ? 'সংরক্ষণ হচ্ছে...' : 'সংরক্ষণ করুন'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
