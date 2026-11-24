import { db } from './db.js';
import { overview } from './stats.js';

export interface Band { id: string; label: string; min: number; max: number }
export const BANDS: Band[] = [
  { id: 'b1', label: 'مبتدئ (أقل من 800)', min: 0, max: 800 },
  { id: 'b2', label: 'متوسط مبكر (800–1200)', min: 800, max: 1200 },
  { id: 'b3', label: 'متوسط (1200–1600)', min: 1200, max: 1600 },
  { id: 'b4', label: 'متقدم (1600+)', min: 1600, max: 9999 },
];
export const bandOf = (r: number) => BANDS.find((b) => r >= b.min && r < b.max) ?? BANDS[0];

// Typical blunder frequency (per game) used as a rough yardstick, not a measured benchmark.
const BLUNDER_TARGET: Record<string, number> = { b1: 2.0, b2: 1.2, b3: 0.8, b4: 0.4 };

const REPERTOIRE: Record<string, { white: string[]; black: string[]; note: string }> = {
  b1: {
    white: ['Italian Game', 'London System'],
    black: ['Caro-Kann Defense', 'Scandinavian Defense'],
    note: 'افتتاحيات تعتمد على أفكار ثابتة (تطوير، تبييت، مركز) بدل حفظ خطوط طويلة.',
  },
  b2: {
    white: ['Italian Game', 'Scotch Game', 'London System'],
    black: ['Caro-Kann Defense', 'French Defense', 'Sicilian Defense'],
    note: 'ابدأ تتعلم الخطط وراء الافتتاحية، لا الحفظ فقط.',
  },
  b3: {
    white: ['Ruy Lopez', 'Queen\'s Gambit', 'English Opening'],
    black: ['Sicilian Defense', 'King\'s Indian Defense', 'Slav Defense'],
    note: 'استثمر في ما تلعبه كثيرًا وعمّق خطوطه الرئيسية.',
  },
  b4: {
    white: ['Ruy Lopez', 'Queen\'s Gambit', 'Catalan Opening'],
    black: ['Sicilian Defense', 'Nimzo-Indian Defense', 'Grünfeld Defense'],
    note: 'حسّن تحضيرك حسب نتائج مبارياتك أمام الخصوم.',
  },
};

export interface CoachAdvice {
  rating: number | null;
  band: Band | null;
  puzzleRating: { min: number; max: number } | null;
  focus: { title: string; why: string; action: string; severity: 'high' | 'medium' | 'low' }[];
  openings: { keep: any[]; fix: any[]; suggestWhite: string[]; suggestBlack: string[]; note: string } | null;
  weekly: string[];
  puzzles: { due: number; total: number; solved: number };
  basedOn: { analysedGames: number; totalGames: number };
}

/** Rule-based coach: turns measured stats + the player's rating into a plan. */
export function buildCoach(profileId: number, rating: number | null, tc = 'rapid'): CoachAdvice {
  const o = overview(profileId, { tc });
  const t = o.totals;
  const band = rating ? bandOf(rating) : null;
  const focus: CoachAdvice['focus'] = [];
  const A = t.analysed;

  if (A >= 3 && band) {
    const target = BLUNDER_TARGET[band.id];
    if (t.blunderPerGame > target) {
      focus.push({
        severity: 'high',
        title: `أخطاء فادحة كثيرة (${t.blunderPerGame.toFixed(1)} لكل مباراة)`,
        why: `مرجع تقريبي وضعناه نحن (وليس إحصاءً منشورًا): نحو ${target} لكل مباراة لمستواك. الأخطاء الفادحة تحسم أغلب المباريات في هذه المستويات.`,
        action: 'قبل كل نقلة اسأل: ما الذي يهدده خصمي؟ وهل قطعتي المتحركة محمية؟ ثم حلّ تمارين أخطائك يوميًا.',
      });
    }
    const ph = o.phases as Record<string, number | null>;
    const entries = (['opening', 'middlegame', 'endgame'] as const).filter((k) => ph[k] != null).map((k) => [k, ph[k]!] as const);
    if (entries.length >= 2) {
      const [wk, wv] = entries.reduce((a, b) => (b[1] < a[1] ? b : a));
      const names = { opening: 'الافتتاح', middlegame: 'الوسط', endgame: 'النهاية' } as const;
      focus.push({
        severity: wv < 75 ? 'high' : 'medium',
        title: `أضعف مرحلة لديك: ${names[wk]} (دقة ${wv.toFixed(0)}%)`,
        why: 'محسوبة من تحليل المحرك لكل نقلاتك في هذه المرحلة.',
        action:
          wk === 'opening' ? 'ثبّت مجموعة صغيرة من الافتتاحيات وراجع أول 10 نقلات بعد كل خسارة.'
          : wk === 'middlegame' ? 'تمارين تكتيكية يومية (شوكات، ربط، هجوم مكشوف) وتجنّب ترك القطع معلقة.'
          : 'أساسيات النهايات: الملك والبيدق، نهايات القلاع (Lucena/Philidor)، وتنشيط الملك.',
      });
    }
    if (t.mistake / A > 1.5) {
      focus.push({
        severity: 'medium',
        title: `أخطاء متوسطة متكررة (${(t.mistake / A).toFixed(1)} لكل مباراة)`,
        why: 'غالبًا ناتجة عن تقييم خاطئ للوضعية أو استعجال.',
        action: 'أبطئ في النقلات الحاسمة (كشّ، أخذ، تهديد) وحلل مبارياتك الخاسرة نقلة بنقلة.',
      });
    }
    const tp = o.timePressure;
    const rate = (b: { moves: number; blunders: number }) => (b.moves ? b.blunders / b.moves : 0);
    if (tp.trouble.moves >= 30 && rate(tp.trouble) > 2 * rate(tp.normal) && rate(tp.trouble) > 0.04) {
      focus.push({
        severity: 'medium',
        title: `أخطاؤك تتضاعف حين يقل وقتك (${(100 * rate(tp.trouble)).toFixed(1)}% مقابل ${(100 * rate(tp.normal)).toFixed(1)}%)`,
        why: `محسوبة من ${tp.trouble.moves} نقلة لعبتها بأقل من 10% من وقتك.`,
        action: 'لا تضيّع الوقت في الافتتاح؛ العب النقلات المألوفة بسرعة وادّخر وقتك للوضعيات الحرجة.',
      });
    }
    if (tp.losses >= 8 && tp.timeoutLosses / tp.losses >= 0.2) {
      focus.push({
        severity: 'medium',
        title: `${tp.timeoutLosses} من ${tp.losses} خسارة كانت بالوقت`,
        why: 'خسارة الوقت غالبًا تعني تفكيرًا طويلًا في أول المباراة.',
        action: 'حدّد لنفسك سقفًا (مثلًا دقيقة لكل نقلة في الافتتاح) وجرّب زمنًا يعطيك وقتًا إضافيًا.',
      });
    }
  } else {
    focus.push({
      severity: 'low',
      title: 'لا تزال بيانات التحليل قليلة',
      why: `حُلّل ${A} من ${t.games} مباراة. اترك المحرك يكمل ليظهر لك تشخيص دقيق.`,
      action: 'تابع التحليل في الخلفية؛ ستتحسن التوصيات كلما زاد العدد.',
    });
  }

  // Openings: best and worst among those with at least 4 games.
  let openings: CoachAdvice['openings'] = null;
  if (band) {
    const cand = o.openings.filter((x) => x.n >= 4);
    const keep = cand.filter((x) => x.score >= 0.55).sort((a, b) => b.score - a.score).slice(0, 3);
    const fix = cand.filter((x) => x.score <= 0.4).sort((a, b) => b.n - a.n).slice(0, 3);
    const rep = REPERTOIRE[band.id];
    openings = { keep, fix, suggestWhite: rep.white, suggestBlack: rep.black, note: rep.note };
  }

  const now = Math.floor(Date.now() / 1000);
  const p = db.prepare('SELECT COUNT(*) total, SUM(solved) solved, SUM(CASE WHEN due_at <= ? AND box < 4 THEN 1 ELSE 0 END) due FROM puzzles WHERE profile_id=?').get(now, profileId) as any;

  const weekly = [
    'يوميًا: 10–15 دقيقة تمارين من أخطائك (قسم التمارين).',
    'يوميًا: 10 تمارين تكتيكية جديدة قريبة من تقييمك.',
    '3 مباريات Rapid طويلة (10+ دقائق) أسبوعيًا، وتحليل كل خسارة بالمحرك.',
    'مرة أسبوعيًا: العب ضد بوت أقوى منك بقليل ثم راجع المباراة.',
    'مرة أسبوعيًا: راجع افتتاحية واحدة من قائمة "تحتاج إصلاح".',
  ];

  return {
    rating,
    band,
    puzzleRating: rating ? { min: Math.max(400, rating - 150), max: rating + 250 } : null,
    focus,
    openings,
    weekly,
    puzzles: { due: p?.due ?? 0, total: p?.total ?? 0, solved: p?.solved ?? 0 },
    basedOn: { analysedGames: A, totalGames: t.games },
  };
}
