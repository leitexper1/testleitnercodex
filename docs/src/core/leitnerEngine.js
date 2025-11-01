const HOURS_TO_MS = 3600 * 1000;

export class LeitnerEngine {
    static DEFAULT_CURVE = [1, 3, 9, 27, 81];

    static DEFAULT_DIFFICULTIES = {
        easy: 0.8,
        normal: 1,
        hard: 1.4
    };

    static getIntervalForBox(box, curve = LeitnerEngine.DEFAULT_CURVE) {
        const index = Math.max(0, Math.min(curve.length - 1, (parseInt(box, 10) || 1) - 1));
        return Number(curve[index]) || curve[curve.length - 1] || 1;
    }

    static getDifficultyMultiplier(key, difficulties = LeitnerEngine.DEFAULT_DIFFICULTIES) {
        if (!key) {
            return 1;
        }
        const normalizedKey = key.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(difficulties, normalizedKey)) {
            const multiplier = Number(difficulties[normalizedKey]);
            return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
        }
        return 1;
    }

    static computeCardNextReview(card, curve, difficulties, now = Date.now(), options = {}) {
        const { ignoreStoredNextReview = false } = options || {};
        if (!card) {
            return now;
        }

        const effectiveCurve = curve || LeitnerEngine.DEFAULT_CURVE;
        const effectiveDifficulties = difficulties || LeitnerEngine.DEFAULT_DIFFICULTIES;

        if (!ignoreStoredNextReview && card.nextReview && Number.isFinite(Number(card.nextReview))) {
            return Number(card.nextReview);
        }

        const lastReview = LeitnerEngine.resolveLastReview(card, now);
        const difficultyKey = card.difficulty || card.difficultyKey;
        const multiplier = LeitnerEngine.getDifficultyMultiplier(difficultyKey, effectiveDifficulties);
        const intervalHours = LeitnerEngine.getIntervalForBox(card.box, effectiveCurve) * multiplier;
        return lastReview + intervalHours * HOURS_TO_MS;
    }

    static evaluateAnswer(card, { isCorrect, difficulty, curve, difficulties, now = Date.now() }) {
        const effectiveCurve = curve || LeitnerEngine.DEFAULT_CURVE;
        const effectiveDifficulties = difficulties || LeitnerEngine.DEFAULT_DIFFICULTIES;

        const currentBox = parseInt(card.box, 10) || 1;
        const nextBox = isCorrect
            ? Math.min(currentBox + 1, effectiveCurve.length)
            : 1;

        const nextDifficulty = difficulty || card.difficulty || card.difficultyKey;
        const multiplier = LeitnerEngine.getDifficultyMultiplier(nextDifficulty, effectiveDifficulties);
        const intervalHours = LeitnerEngine.getIntervalForBox(nextBox, effectiveCurve) * multiplier;

        const scheduledAt = now + intervalHours * HOURS_TO_MS;

        return {
            ...card,
            box: nextBox,
            lastReview: now,
            difficulty: nextDifficulty || card.difficulty || 'normal',
            nextReview: scheduledAt
        };
    }

    static normaliseDeck(cards, options = {}) {
        const context = resolveEngineContext(options);
        return (cards || []).map(card =>
            LeitnerEngine.normaliseCard(card, context)
        );
    }

    static summariseBoxes(cards, options = {}) {
        const context = resolveEngineContext(options);
        const deck = buildScheduledDeck(cards, context);
        const summaries = [];

        for (let index = 0; index < context.curve.length; index += 1) {
            const boxNumber = index + 1;
            const cardsInBox = deck.filter(card => card.box === boxNumber);
            const nextReview = cardsInBox.length > 0
                ? Math.min(...cardsInBox.map(card => card.nextReview))
                : null;
            const dueCount = cardsInBox.filter(card => card.nextReview <= context.now).length;

            summaries.push({
                box: boxNumber,
                count: cardsInBox.length,
                due: dueCount,
                nextReview: Number.isFinite(nextReview) ? nextReview : null
            });
        }

        return summaries;
    }

    static getCardsForBox(cards, boxNumber, options = {}) {
        const context = resolveEngineContext(options);
        const normalisedBox = Math.max(1, Math.min(context.curve.length, parseInt(boxNumber, 10) || 1));
        const deck = buildScheduledDeck(cards, context);

        return deck
            .filter(card => card.box === normalisedBox)
            .sort((a, b) => a.nextReview - b.nextReview);
    }

    static selectNextCard(cards, options = {}) {
        const context = resolveEngineContext(options);
        const deck = buildScheduledDeck(cards, context);

        if (deck.length === 0) {
            return null;
        }

        const dueCards = deck.filter(card => card.nextReview <= context.now);
        const ordered = (dueCards.length > 0 ? dueCards : deck)
            .slice()
            .sort((a, b) => a.nextReview - b.nextReview);

        return ordered[0] || null;
    }

    static normaliseCard(card, {
        curve,
        difficulties,
        defaultDifficulty = 'normal',
        now = Date.now(),
        recomputeNextReview = false,
        curveOverride = false,
        difficultiesOverride = false
    } = {}) {
        const effectiveCurve = curve || LeitnerEngine.DEFAULT_CURVE;
        const effectiveDifficulties = difficulties || LeitnerEngine.DEFAULT_DIFFICULTIES;

        const normalisedBox = Math.max(1, Math.min(effectiveCurve.length, parseInt(card.box, 10) || 1));
        const lastReview = LeitnerEngine.resolveLastReview(card, now);
        const difficulty = (card.difficulty || card.difficultyKey || defaultDifficulty || 'normal').toLowerCase();

        const baseCard = {
            ...card,
            box: normalisedBox,
            lastReview,
            difficulty
        };

        const shouldForceReschedule = recomputeNextReview || curveOverride || difficultiesOverride;
        const shouldReuseStored = !shouldForceReschedule && card.nextReview && Number.isFinite(Number(card.nextReview));
        const schedulingCard = shouldReuseStored ? baseCard : { ...baseCard, nextReview: undefined };

        const nextReview = shouldReuseStored
            ? Number(card.nextReview)
            : LeitnerEngine.computeCardNextReview(
                schedulingCard,
                effectiveCurve,
                effectiveDifficulties,
                now,
                { ignoreStoredNextReview: true }
            );

        return {
            ...schedulingCard,
            nextReview
        };
    }

    static resolveLastReview(card, fallback) {
        if (!card) {
            return fallback;
        }

        if (typeof card.lastReview === 'number') {
            return card.lastReview;
        }

        if (card.lastReview instanceof Date) {
            return card.lastReview.getTime();
        }

        const parsed = Date.parse(card.lastReview);
        if (Number.isFinite(parsed)) {
            return parsed;
        }

        return fallback;
    }
}

function resolveEngineContext(options = {}) {
    if (!options || typeof options !== 'object') {
        return {
            curve: [...LeitnerEngine.DEFAULT_CURVE],
            difficulties: { ...LeitnerEngine.DEFAULT_DIFFICULTIES },
            defaultDifficulty: 'normal',
            now: Date.now(),
            recomputeNextReview: false,
            curveOverride: false,
            difficultiesOverride: false
        };
    }

    const {
        curve = LeitnerEngine.DEFAULT_CURVE,
        difficulties = LeitnerEngine.DEFAULT_DIFFICULTIES,
        defaultDifficulty = 'normal',
        now = Date.now(),
        recomputeNextReview = false
    } = options;

    const resolvedCurve = Array.isArray(curve) && curve.length > 0
        ? curve.map(value => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 1))
        : [...LeitnerEngine.DEFAULT_CURVE];

    const resolvedDifficulties = {
        ...LeitnerEngine.DEFAULT_DIFFICULTIES,
        ...(difficulties && typeof difficulties === 'object' ? difficulties : {})
    };

    const resolvedDefaultDifficulty = typeof defaultDifficulty === 'string' && defaultDifficulty.trim()
        ? defaultDifficulty.trim().toLowerCase()
        : 'normal';

    const resolvedNow = Number.isFinite(now) ? Number(now) : Date.now();
    const resolvedRecompute = Boolean(recomputeNextReview);
    const hasCurveOverride = Object.prototype.hasOwnProperty.call(options, 'curve');
    const hasDifficultiesOverride = Object.prototype.hasOwnProperty.call(options, 'difficulties');

    return {
        curve: resolvedCurve,
        difficulties: resolvedDifficulties,
        defaultDifficulty: resolvedDefaultDifficulty,
        now: resolvedNow,
        recomputeNextReview: resolvedRecompute,
        curveOverride: hasCurveOverride,
        difficultiesOverride: hasDifficultiesOverride
    };
}

function buildScheduledDeck(cards, context) {
    const shouldReschedule = Boolean(
        context.recomputeNextReview
        || context.curveOverride
        || context.difficultiesOverride
    );

    const normalisationContext = {
        ...context,
        recomputeNextReview: shouldReschedule,
        curveOverride: false,
        difficultiesOverride: false
    };

    return (cards || []).map(card => {
        const normalised = LeitnerEngine.normaliseCard(card, normalisationContext);
        const nextReview = LeitnerEngine.computeCardNextReview(
            normalised,
            context.curve,
            context.difficulties,
            context.now,
            {
                ignoreStoredNextReview: shouldReschedule
            }
        );

        return {
            ...normalised,
            nextReview
        };
    });
}
