#!/usr/bin/env node
/**
 * draft-descriptions — fills the semantic half of every KB record.
 *
 * B1 harvested the facts. This is the content pass: the `description`, `tags`, `intents`,
 * `valence` and `energy` that decide whether the right clip comes back for the right
 * feeling — which is to say, whether she feels right.
 *
 * Spec §5.P0 sets the formula: **action + body focus + tempo + emotion**. Three of those
 * four come from an authored lexicon below; `tempo` comes from the measured statistics, so
 * two takes of the same emotion never read identically and the anti-repeat memory of §6.5
 * has something to tell them apart by.
 *
 * The lexicon is the human-authored artefact of this batch. It is deliberately small
 * enough to read in one sitting and to argue with: change a valence here and the ranker's
 * mood matching changes everywhere that emotion appears.
 *
 * ## The approval gate
 *
 * The batch plan says an LLM drafts and a human approves every line. This script is the
 * drafting half. The approving half is `kb/descriptions.approved.json`, and until a person
 * signs a description off there, `validate-manifest.mjs --require-approval` fails. CI does
 * not run that flag yet, on purpose: pretending the review happened would be worse than
 * saying plainly that it has not.
 *
 * Usage:
 *   node kb/scripts/draft-descriptions.mjs           # show what would change
 *   node kb/scripts/draft-descriptions.mjs --write   # write the manifest + ledger
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MANIFEST = 'kb/animations.manifest.jsonl';
const LEDGER = 'kb/descriptions.approved.json';

/**
 * Emotional vocabulary — the `emotion/` pack is the GoEmotions taxonomy, and the VRMA and
 * procedural sets reuse the same feelings.
 *
 * `[gesture, bodyFocus, tone, valence, energyFloor, tags]`
 *
 * `valence` is the number the ranker matches against the blackboard's mood, so it is the
 * one value here worth arguing about. `energyFloor` only applies where no motion capture
 * exists to measure (the procedural behaviours); everywhere else energy is measured.
 */
const EMOTIONS = {
    admiration: [
        'an appreciative look upward',
        'head tilting, hands opening at chest height',
        'warm and impressed',
        0.7,
        0.3,
        ['admiration', 'warm', 'positive'],
    ],
    amusement: [
        'a laughing rock back',
        'shoulders shaking, head tipping back',
        'delighted and playful',
        0.8,
        0.5,
        ['amusement', 'laugh', 'playful', 'positive'],
    ],
    anger: [
        'a sharp forward jab of the shoulders',
        'chest squared, fists tight, chin down',
        'hot and confrontational',
        -0.7,
        0.6,
        ['anger', 'hostile', 'negative'],
    ],
    annoyance: [
        'a clipped shrug and turn away',
        'shoulders lifting once, head shaking off',
        'irritated and dismissive',
        -0.4,
        0.3,
        ['annoyance', 'irritated', 'negative'],
    ],
    approval: [
        'a settled nod',
        'head nodding, hands relaxing open',
        'agreeable and reassuring',
        0.6,
        0.25,
        ['approval', 'agree', 'nod', 'positive'],
    ],
    caring: [
        'a soft reach toward the other person',
        'arms opening low, weight leaning in',
        'tender and protective',
        0.7,
        0.25,
        ['caring', 'tender', 'console', 'positive'],
    ],
    confusion: [
        'a slow head tilt with a half-raised hand',
        'head cocking, one shoulder rising',
        'puzzled and searching',
        -0.1,
        0.25,
        ['confusion', 'puzzled', 'thinking'],
    ],
    curiosity: [
        'a lean toward whatever caught her attention',
        'head forward, chest following, hands still',
        'interested and alert',
        0.4,
        0.3,
        ['curiosity', 'interest', 'lean_in', 'thinking'],
    ],
    desire: [
        'a slow draw inward with held eye contact',
        'chest lifting, hips settling, shoulders soft',
        'wanting and unhurried',
        0.5,
        0.3,
        ['desire', 'longing', 'warm'],
    ],
    disappointment: [
        'a deflating drop of the shoulders',
        'chest sinking, head lowering, arms going slack',
        'let down and quiet',
        -0.6,
        0.2,
        ['disappointment', 'deflated', 'sad', 'negative'],
    ],
    disapproval: [
        'a firm head shake with folded arms',
        'arms crossing, head turning away',
        'unconvinced and closed',
        -0.5,
        0.3,
        ['disapproval', 'disagree', 'negative'],
    ],
    disgust: [
        'a recoil and turn of the face',
        'torso pulling back, nose and shoulders lifting',
        'repelled and blunt',
        -0.7,
        0.4,
        ['disgust', 'recoil', 'negative'],
    ],
    embarrassment: [
        'a shrinking half-turn with a covered face',
        'shoulders rounding, hands rising to cheek',
        'flustered and self-conscious',
        -0.2,
        0.3,
        ['embarrassment', 'shy', 'blush'],
    ],
    excitement: [
        'a bouncing surge onto the toes',
        'arms flying up, chest open, head high',
        'thrilled and unrestrained',
        0.9,
        0.7,
        ['excitement', 'thrilled', 'celebrate', 'positive'],
    ],
    fear: [
        'a flinch back and freeze',
        'arms guarding the chest, shoulders up at the ears',
        'alarmed and braced',
        -0.8,
        0.5,
        ['fear', 'alarm', 'negative'],
    ],
    gratitude: [
        'a small bow with both hands together',
        'head dipping, hands meeting at the sternum',
        'grateful and sincere',
        0.8,
        0.25,
        ['gratitude', 'thanks', 'positive'],
    ],
    grief: [
        'a folding inward over the chest',
        'head dropping into the hands, spine curling',
        'stricken and heavy',
        -0.9,
        0.2,
        ['grief', 'mourning', 'sad', 'negative'],
    ],
    joy: [
        'an open, lifting celebration',
        'arms rising, chest opening, head up',
        'bright and delighted',
        0.9,
        0.6,
        ['joy', 'happy', 'celebrate', 'positive'],
    ],
    love: [
        'a warm gather of both hands to the heart',
        'chest opening, head tilting, weight leaning in',
        'affectionate and unguarded',
        0.9,
        0.3,
        ['love', 'affection', 'warm', 'positive'],
    ],
    nervousness: [
        'a restless shift with fidgeting hands',
        'weight passing foot to foot, fingers worrying',
        'anxious and unsettled',
        -0.4,
        0.35,
        ['nervousness', 'anxious', 'fidget', 'negative'],
    ],
    optimism: [
        'a forward-leaning open gesture',
        'chest lifting, palms turning up, chin rising',
        'hopeful and forward-looking',
        0.7,
        0.35,
        ['optimism', 'hopeful', 'positive'],
    ],
    pride: [
        'a squared, expansive stance',
        'chest out, shoulders back, hands on hips',
        'pleased and self-assured',
        0.8,
        0.4,
        ['pride', 'confident', 'celebrate', 'positive'],
    ],
    realization: [
        'a sudden still moment, then a lifted head',
        'head snapping up, one hand rising',
        'struck by an idea',
        0.4,
        0.4,
        ['realization', 'surprised', 'thinking'],
    ],
    relief: [
        'a long exhale and unclenching',
        'shoulders dropping, chest emptying, head falling back',
        'released and softened',
        0.6,
        0.15,
        ['relief', 'calm', 'breathe', 'positive'],
    ],
    remorse: [
        'a turned-away apology with a lowered head',
        'head bowing, one hand rubbing the other arm',
        'sorry and withdrawn',
        -0.6,
        0.2,
        ['remorse', 'regret', 'sad', 'negative'],
    ],
    sadness: [
        'a slow sink with a lowered gaze',
        'shoulders rounding, head dropping, arms hanging',
        'downcast and slow',
        -0.8,
        0.15,
        ['sadness', 'sad', 'negative'],
    ],
    surprise: [
        'a sharp recoil with both hands rising',
        'chest pulling back, head jerking, hands flying up',
        'startled and wide open',
        0.2,
        0.6,
        ['surprise', 'surprised', 'startle'],
    ],
};

/** Typos in the shipped filenames, mapped to the emotion they meant. */
const EMOTION_ALIASES = { disaproval: 'disapproval', nervousnes: 'nervousness' };

/**
 * Everything that is an action rather than a feeling: postures, gestures, exercise, dance,
 * and the procedural behaviours. Same shape as EMOTIONS.
 */
const ACTIONS = {
    // ── postures and idles ────────────────────────────────────────────────
    neutral: [
        'a settled standing rest',
        'weight even, arms hanging, small breathing sway',
        'calm and available',
        0.1,
        0.1,
        ['idle', 'rest', 'neutral', 'breathe'],
    ],
    neutral_idle: [
        'a quiet standing idle',
        'micro-shifts through the hips, chest rising and falling',
        'unhurried and present',
        0.1,
        0.1,
        ['idle', 'rest', 'neutral', 'breathe'],
    ],
    sit_idle: [
        'a seated rest',
        'hips settled, spine easy, hands loose in the lap',
        'relaxed and stationary',
        0.1,
        0.1,
        ['sit', 'idle', 'rest', 'posture'],
    ],
    kneel_idle: [
        'a kneeling rest',
        'weight down through the shins, torso upright',
        'grounded and still',
        0.1,
        0.1,
        ['kneel', 'idle', 'rest', 'posture'],
    ],
    laying_idle: [
        'a lying rest',
        'body long on the floor, slow chest movement',
        'still and low',
        0.0,
        0.05,
        ['lay', 'idle', 'rest', 'posture'],
    ],
    waiting: [
        'a patient waiting loop',
        'weight shifting between feet, arms folding and unfolding',
        'attentive and unbothered',
        0.2,
        0.15,
        ['waiting', 'idle', 'patient'],
    ],
    relax: [
        'an easing-down of the whole body',
        'shoulders dropping, spine lengthening, breath slowing',
        'unwound and soft',
        0.4,
        0.15,
        ['relax', 'calm', 'breathe', 'idle'],
    ],
    sleepy: [
        'a drowsy sag with a slow blink',
        'head nodding forward, shoulders sinking',
        'heavy-lidded and slow',
        0.1,
        0.1,
        ['sleepy', 'tired', 'idle'],
    ],
    lookaround: [
        'a slow scan of the surroundings',
        'head turning, eyes leading, torso following late',
        'curious and unhurried',
        0.3,
        0.2,
        ['lookaround', 'scan', 'curiosity'],
    ],
    // ── greetings and social gestures ─────────────────────────────────────
    waving: [
        'a raised open-handed wave',
        'one arm lifting high, wrist swinging, chest turning in',
        'friendly and welcoming',
        0.7,
        0.35,
        ['wave', 'greeting', 'hello', 'positive'],
    ],
    action_greeting: [
        'a greeting with a lifted hand',
        'arm raising to shoulder height, torso squaring up',
        'welcoming and direct',
        0.7,
        0.3,
        ['wave', 'greeting', 'hello', 'positive'],
    ],
    standinggreeting: [
        'a standing greeting with an open gesture',
        'both arms opening outward, chest lifting',
        'warm and inviting',
        0.7,
        0.3,
        ['wave', 'greeting', 'hello', 'positive'],
    ],
    goodbye: [
        'a parting wave',
        'one arm sweeping across and down, weight shifting back',
        'fond and final',
        0.5,
        0.3,
        ['wave', 'goodbye', 'farewell'],
    ],
    bowing: [
        'a formal bow from the waist',
        'spine hinging forward, arms staying at the sides',
        'respectful and composed',
        0.5,
        0.25,
        ['bow', 'respect', 'greeting', 'formal'],
    ],
    standingclap: [
        'a standing round of applause',
        'hands meeting at chest height, elbows driving',
        'appreciative and encouraging',
        0.8,
        0.45,
        ['clap', 'applause', 'celebrate', 'positive'],
    ],
    clapping: [
        'brisk applause',
        'hands clapping in front of the chest, shoulders bouncing',
        'pleased and encouraging',
        0.8,
        0.45,
        ['clap', 'applause', 'celebrate', 'positive'],
    ],
    shrugging: [
        'a two-shouldered shrug with open palms',
        'shoulders lifting, forearms turning out, head tilting',
        'unsure and candid',
        -0.1,
        0.25,
        ['shrug', 'unsure', 'disagree'],
    ],
    talking: [
        'a conversational gesture run',
        'hands moving in the speaking space, head punctuating',
        'engaged and expressive',
        0.4,
        0.3,
        ['talk', 'speak', 'gesture', 'conversation'],
    ],
    singing: [
        'a sung phrase with lifted chest',
        'ribcage opening, arms drifting outward, head rising',
        'expressive and carrying',
        0.7,
        0.4,
        ['sing', 'perform', 'music', 'positive'],
    ],
    action_pat: [
        'a gentle pat toward the other person',
        'one arm reaching out and down, weight leaning in',
        'reassuring and close',
        0.6,
        0.25,
        ['pat', 'console', 'caring', 'touch'],
    ],
    action_attention_seeking: [
        'a repeated bid for attention',
        'arm waving overhead, weight bouncing, head tracking',
        'insistent and playful',
        0.4,
        0.3,
        ['attention', 'wave', 'point', 'playful'],
    ],
    blush: [
        'a flustered turn with a hand to the face',
        'head ducking, shoulders rounding, hand rising to cheek',
        'bashful and warm',
        0.3,
        0.25,
        ['blush', 'shy', 'embarrassment'],
    ],
    // ── celebration ───────────────────────────────────────────────────────
    victory: [
        'a triumphant fist-pump',
        'arms punching up, chest opening, weight rising',
        'elated and victorious',
        0.9,
        0.7,
        ['victory', 'celebrate', 'win', 'positive'],
    ],
    victoryidle: [
        'a held victory pose',
        'arms up and steady, chest proud, feet planted',
        'triumphant and settled',
        0.8,
        0.35,
        ['victory', 'celebrate', 'win', 'positive'],
    ],
    happyidle: [
        'a happy standing loop',
        'light bounce through the knees, arms swinging small',
        'content and buoyant',
        0.8,
        0.3,
        ['happy', 'idle', 'positive'],
    ],
    sadidle: [
        'a dejected standing loop',
        'head low, shoulders rounded, arms heavy',
        'downcast and slow',
        -0.7,
        0.15,
        ['sad', 'idle', 'negative'],
    ],
    backflip: [
        'a full backflip',
        'whole body rotating through the air, arms driving the turn',
        'showy and athletic',
        0.7,
        0.95,
        ['backflip', 'acrobatic', 'celebrate', 'stunt'],
    ],
    jump: [
        'a two-footed jump',
        'knees loading, arms swinging up, body leaving the floor',
        'energetic and abrupt',
        0.6,
        0.7,
        ['jump', 'hop', 'energetic'],
    ],
    action_jump: [
        'a standing jump',
        'legs coiling and releasing, arms lifting on take-off',
        'quick and springy',
        0.6,
        0.7,
        ['jump', 'hop', 'energetic'],
    ],
    // ── locomotion and utility ────────────────────────────────────────────
    action_walk: [
        'an even walk',
        'legs alternating, arms counter-swinging, torso level',
        'steady and unhurried',
        0.2,
        0.35,
        ['walk', 'locomotion', 'travel'],
    ],
    action_jog: [
        'a light jog',
        'knees lifting, arms driving at the ribs, torso leaning in',
        'brisk and rhythmic',
        0.4,
        0.6,
        ['jog', 'run', 'locomotion', 'travel'],
    ],
    action_run: [
        'a full run',
        'long stride, arms pumping, chest driving forward',
        'urgent and fast',
        0.3,
        0.85,
        ['run', 'sprint', 'locomotion', 'travel'],
    ],
    action_crawling: [
        'a crawl along the floor',
        'weight on hands and knees, hips swinging low',
        'low and deliberate',
        -0.1,
        0.4,
        ['crawl', 'low', 'locomotion'],
    ],
    action_crouch: [
        'a drop into a crouch',
        'knees folding, hips sinking, chest staying up',
        'compact and watchful',
        0.0,
        0.3,
        ['crouch', 'low', 'posture'],
    ],
    action_standup: [
        'a rise to standing',
        'hips lifting, spine unrolling, arms finding balance',
        'purposeful and grounded',
        0.2,
        0.35,
        ['standup', 'rise', 'posture'],
    ],
    action_laydown: [
        'a lowering to the floor',
        'knees bending, hips descending, body lengthening out',
        'careful and slow',
        0.0,
        0.3,
        ['laydown', 'low', 'posture'],
    ],
    action_pickingup: [
        'a bend to pick something up',
        'hips hinging, one arm reaching down, back staying long',
        'practical and brief',
        0.1,
        0.3,
        ['pickup', 'reach', 'utility'],
    ],
    action_gaming: [
        'an absorbed seated gaming loop',
        'forearms working, shoulders hunched, head fixed forward',
        'focused and twitchy',
        0.3,
        0.25,
        ['gaming', 'focus', 'seated'],
    ],
    // ── exercise ──────────────────────────────────────────────────────────
    exercise_crunch: [
        'an abdominal crunch',
        'shoulders curling off the floor, knees bent, hands at the head',
        'effortful and controlled',
        0.2,
        0.4,
        ['exercise', 'crunch', 'core', 'workout'],
    ],
    exercise_crunches: [
        'a run of repeated crunches',
        'torso curling up and releasing on a steady count',
        'rhythmic and working',
        0.2,
        0.55,
        ['exercise', 'crunch', 'core', 'workout', 'reps'],
    ],
    exercise_jogging: [
        'a jogging drill on the spot',
        'knees cycling, arms driving, torso staying tall',
        'aerobic and even',
        0.4,
        0.6,
        ['exercise', 'jog', 'cardio', 'workout'],
    ],
    exercise_jumping_jacks: [
        'a set of jumping jacks',
        'arms and legs opening and closing together on the beat',
        'brisk and full-bodied',
        0.5,
        0.8,
        ['exercise', 'jumping jacks', 'cardio', 'workout', 'reps'],
    ],
    jumpingjacks: [
        'a set of jumping jacks',
        'arms and legs opening and closing together on the beat',
        'brisk and full-bodied',
        0.5,
        0.8,
        ['exercise', 'jumping jacks', 'cardio', 'workout', 'reps'],
    ],
    // ── dance ─────────────────────────────────────────────────────────────
    dance: [
        'a full-bodied dance',
        'hips leading, arms sweeping, weight travelling through the feet',
        'loose and celebratory',
        0.8,
        0.7,
        ['dance', 'groove', 'party', 'celebrate', 'music'],
    ],
    dance_dab: [
        'a dab',
        'one arm sweeping across the face, the other extending out and up',
        'cocky and punctuating',
        0.7,
        0.5,
        ['dance', 'dab', 'meme', 'celebrate'],
    ],
    dance_gangnam_style: [
        'the gangnam horse-riding step',
        'wrists crossing low, knees bouncing, hips driving the beat',
        'comic and relentless',
        0.8,
        0.75,
        ['dance', 'gangnam', 'meme', 'party', 'celebrate'],
    ],
    dance_headdrop: [
        'a head-drop groove',
        'head snapping down on the beat, shoulders rolling after it',
        'moody and rhythmic',
        0.6,
        0.6,
        ['dance', 'groove', 'rhythm', 'music'],
    ],
    dance_marachinostep: [
        'a marching side-step routine',
        'feet stepping side to side, arms swinging across the body',
        'jaunty and repetitive',
        0.7,
        0.6,
        ['dance', 'step', 'party', 'music'],
    ],
    dance_northern_soul_spin: [
        'a northern-soul spin',
        'a fast full turn on one foot, arms trailing wide',
        'showy and athletic',
        0.8,
        0.85,
        ['dance', 'spin', 'soul', 'party', 'celebrate'],
    ],
    dance_ontop: [
        'a raised-arm dance run',
        'arms held high, chest bouncing, hips swinging under',
        'exultant and open',
        0.8,
        0.7,
        ['dance', 'party', 'celebrate', 'music'],
    ],
    dance_pushback: [
        'a push-back step routine',
        'hands pressing forward, weight rocking back, knees bouncing',
        'punchy and rhythmic',
        0.7,
        0.65,
        ['dance', 'groove', 'party', 'music'],
    ],
    dance_rumba: [
        'a rumba figure',
        'hips figure-eighting, weight transferring slowly, arms shaping',
        'sensual and controlled',
        0.7,
        0.5,
        ['dance', 'rumba', 'latin', 'music'],
    ],
    dance_backup: [
        'a backing-dancer routine',
        'coordinated steps and arm lines, weight travelling side to side',
        'supporting and rhythmic',
        0.7,
        0.6,
        ['dance', 'routine', 'music'],
    ],
    breakdanceuprock: [
        'a breakdance uprock',
        'sharp footwork with crossing arm strikes, torso jutting',
        'aggressive and stylish',
        0.7,
        0.85,
        ['dance', 'breakdance', 'hiphop', 'party'],
    ],
    hiphopdance: [
        'a hip-hop groove',
        'bouncing knees, alternating arm waves, head bobbing on beat',
        'confident and playful',
        0.8,
        0.75,
        ['dance', 'hiphop', 'party', 'celebrate'],
    ],
    hiphopdancing: [
        'a hip-hop groove',
        'bouncing knees, alternating arm waves, head bobbing on beat',
        'confident and playful',
        0.8,
        0.75,
        ['dance', 'hiphop', 'party', 'celebrate'],
    ],
    sambadancing: [
        'a samba',
        'fast footwork under a steady torso, hips driving continuously',
        'festive and quick',
        0.9,
        0.85,
        ['dance', 'samba', 'latin', 'party', 'celebrate'],
    ],
    rumbadancing: [
        'a rumba',
        'hips figure-eighting, slow weight transfer, shaping arms',
        'sensual and controlled',
        0.7,
        0.5,
        ['dance', 'rumba', 'latin', 'music'],
    ],
    twistdance: [
        'the twist',
        'hips and knees counter-rotating, arms swinging across',
        'retro and playful',
        0.8,
        0.6,
        ['dance', 'twist', 'retro', 'party'],
    ],
    sillydancing: [
        'a deliberately silly dance',
        'flailing arms, uncoordinated knees, exaggerated head',
        'goofy and disarming',
        0.8,
        0.7,
        ['dance', 'silly', 'comic', 'playful', 'party'],
    ],
    dancingtwerk: [
        'a twerk',
        'hips driving fast in a low squat, torso braced forward',
        'provocative and high-tempo',
        0.5,
        0.85,
        ['dance', 'twerk', 'provocative', 'party'],
    ],
    // ── procedural behaviours (AnimationPresets) ──────────────────────────
    idle: [
        'the base idle behaviour',
        'breathing sway, blinks, small weight shifts, gaze finding the user',
        'present and unhurried',
        0.1,
        0.1,
        ['idle', 'rest', 'breathe', 'neutral'],
    ],
    happy: [
        'the happy behaviour',
        'lifted chest, bouncing weight, open arms',
        'bright and warm',
        0.8,
        0.5,
        ['happy', 'joy', 'positive'],
    ],
    sad: [
        'the sad behaviour',
        'lowered head, rounded shoulders, slowed movement',
        'downcast and quiet',
        -0.7,
        0.15,
        ['sad', 'negative'],
    ],
    angry: [
        'the angry behaviour',
        'squared chest, tightened arms, sharpened head turns',
        'hot and closed',
        -0.7,
        0.55,
        ['angry', 'hostile', 'negative'],
    ],
    surprised: [
        'the surprised behaviour',
        'sudden recoil, raised hands, head pulling back',
        'startled and open',
        0.2,
        0.6,
        ['surprised', 'startle'],
    ],
    thinking: [
        'the thinking behaviour',
        'head tilting, gaze drifting off, one hand rising toward the chin',
        'considering and inward',
        0.1,
        0.2,
        ['thinking', 'consider', 'curiosity'],
    ],
    talk: [
        'the talking behaviour',
        'hands working in the speaking space, head punctuating phrases',
        'engaged and expressive',
        0.4,
        0.3,
        ['talk', 'speak', 'gesture', 'conversation'],
    ],
    // ── procedural, adult tier (gated by SpicyGate + the ranker) ──────────
    flirt: [
        'the flirt behaviour',
        'weight cocking to one hip, chin dipping, gaze holding',
        'playful and inviting',
        0.6,
        0.3,
        ['flirt', 'playful', 'adult'],
    ],
    tease: [
        'the teasing behaviour',
        'a turn away and back, shoulders leading, chin over the shoulder',
        'mischievous and withholding',
        0.5,
        0.35,
        ['tease', 'playful', 'adult'],
    ],
    beckon: [
        'the beckoning behaviour',
        'one hand curling inward, torso opening, weight drawing back',
        'inviting and unhurried',
        0.5,
        0.25,
        ['beckon', 'invite', 'adult'],
    ],
    sensualsway: [
        'the sensual sway behaviour',
        'slow figure-eight through the hips, shoulders trailing',
        'languid and deliberate',
        0.5,
        0.25,
        ['sensual', 'sway', 'slow', 'adult'],
    ],
    slowburn: [
        'the slow-burn behaviour',
        'minimal movement, long holds, breath leading everything',
        'restrained and intent',
        0.4,
        0.15,
        ['slow burn', 'restrained', 'intimate', 'adult'],
    ],
    intimate: [
        'the intimate behaviour',
        'close, small movements, weight settled, chest open',
        'close and unhurried',
        0.6,
        0.2,
        ['intimate', 'close', 'adult'],
    ],
};

/**
 * Tempo bands, from the measured energy proxy.
 *
 * The wording has to sit honestly next to any gesture, because the measurement sometimes
 * disagrees with the name: `joy.bvh` is a genuinely subtle take, and "an open, lifting
 * celebration … almost still" reads as a contradiction where "small and contained" reads
 * as a restrained performance — which is what it is, and what makes it the right pick when
 * the blackboard's energy is low.
 */
const TEMPO = [
    [0.12, 'small and contained'],
    [0.25, 'unhurried'],
    [0.45, 'measured'],
    [0.65, 'lively'],
    [0.85, 'fast'],
    [Infinity, 'explosive'],
];

/**
 * Retrieval synonyms for each tempo band, added as tags.
 *
 * Prose wants one precise word; search wants every word a person might type. Without
 * these, "energetic" is a rare term that happens to appear in one or two descriptions, so
 * IDF makes it enormous and a query for "energetic celebration dance" returns a jump.
 * Tying the vocabulary to the *measurement* instead means every clip that actually moves
 * fast answers to "energetic", which is both better retrieval and a truer statement.
 */
const TEMPO_SYNONYMS = {
    'small and contained': ['subtle', 'still', 'low energy'],
    unhurried: ['calm', 'gentle', 'low energy'],
    measured: ['moderate', 'steady'],
    lively: ['energetic', 'upbeat', 'high energy'],
    fast: ['energetic', 'quick', 'high energy'],
    explosive: ['energetic', 'intense', 'high energy'],
};

/** How far the clip travels, in body heights. */
const TRAVEL = [
    [0.15, ''],
    [0.5, 'shifting a step or two off the mark'],
    [Infinity, 'travelling across the floor'],
];

/**
 * Per-kind divisors that turn the measured proxy (rad/s) into 0..1.
 *
 * Anchored on each pack's 90th percentile rather than its maximum: BVH and VRMA sample
 * their keyframes at different densities, so the raw numbers are not comparable, and
 * anchoring on the extreme would squash almost the whole library into the bottom two
 * tempo bands. B1's harvest report carries the distributions these came from.
 */
const ENERGY_SCALE = { bvh: 0.55, vrma: 1.4 };

/**
 * Whitelisted emote → the tags a clip must carry to answer it (§6.2, §6.8).
 *
 * This is the map that makes the tag contract real: an emote the LLM is told it may use,
 * with nothing in the KB to resolve it, is a dead intent that fails silently at runtime.
 * The test asserts every whitelisted name resolves to at least one clip.
 */
const WHITELIST_INTENTS = {
    happy: ['joy', 'happy', 'amusement', 'excitement'],
    sad: ['sad', 'sadness', 'grief', 'disappointment', 'remorse'],
    angry: ['angry', 'anger', 'annoyance'],
    surprised: ['surprised', 'surprise', 'startle', 'realization'],
    thinking: ['thinking', 'confusion', 'curiosity', 'consider'],
    celebrate: ['celebrate', 'victory', 'clap', 'applause', 'pride'],
    dance: ['dance'],
    wave: ['wave', 'greeting', 'hello', 'goodbye'],
    flirt: ['flirt'],
    tease: ['tease'],
    shy: ['shy', 'blush', 'embarrassment'],
    agree: ['approval', 'agree', 'nod'],
    disagree: ['disapproval', 'disagree', 'shrug', 'disgust'],
    idle: ['idle', 'rest'],
    point: ['point', 'attention'],
    lean_in: ['lean_in', 'curiosity', 'interest', 'desire'],
    nod_along: ['nod', 'approval', 'rhythm', 'groove'],
    breathe: ['breathe', 'relax', 'calm'],
    console: ['console', 'caring', 'pat', 'tender'],
};

// ── derivation ───────────────────────────────────────────────────────────────

function band(table, value) {
    for (const [limit, label] of table) if (value <= limit) return label;
    return table[table.length - 1][1];
}

/** Normalise a filename stem to a lexicon key: strip the take number, fold the case. */
function lexiconKey(stem) {
    const lower = stem.toLowerCase().replace(/[-\s]+/g, '_');
    const base = lower.replace(/_?\d+$/, '');
    return EMOTION_ALIASES[base] || base;
}

/** Find the lexicon entry for a record, trying the most specific key first. */
function lookup(stem, category) {
    const key = lexiconKey(stem);
    const parts = key.split('_');
    // Most specific first, then the compound's head and tail ("waiting_standard" is a
    // waiting loop), then the category as the last resort.
    const candidates = [key, key.replace(/^action_/, ''), parts[0], parts[parts.length - 1], category];
    for (const candidate of candidates) {
        if (ACTIONS[candidate]) return { entry: ACTIONS[candidate], key: candidate };
        if (EMOTIONS[candidate]) return { entry: EMOTIONS[candidate], key: candidate };
    }
    return null;
}

/** Which take is this — `joy2` is the second, `joy` the first. */
function takeNumber(stem) {
    const match = stem.toLowerCase().match(/(\d+)$/);
    return match ? Number(match[1]) : 1;
}

const ORDINALS = ['', '', 'a second take', 'a third take', 'a fourth take'];

/**
 * Compose one description: action + body focus + tempo + emotion, per §5.P0.
 * Tempo and travel come from the measurements, so two takes never read identically.
 */
function describe(record, stem, category) {
    const found = lookup(stem, category);
    if (!found) return null;

    const [gesture, body, tone] = found.entry;
    const energy = energyOf(record, found.entry);
    const tempo = band(TEMPO, energy);
    const travel = band(TRAVEL, record.stats.rootMotion ?? 0);
    const take = takeNumber(stem);

    const pace = travel ? `${tempo}, ${travel}` : tempo;
    const sentence = `${capitalise(gesture)} — ${body}; ${pace}. ${capitalise(tone)}.`;
    return take > 1 && ORDINALS[take] ? `${sentence} Recorded as ${ORDINALS[take]}.` : sentence;
}

/** Measured energy where motion capture exists; the lexicon's floor where it does not. */
function energyOf(record, entry) {
    const measured = record.stats.meanJointVel;
    const scale = ENERGY_SCALE[record.kind];
    if (measured === null || measured === undefined || !scale) return entry[4];
    return Math.min(1, Math.round((measured / scale) * 100) / 100);
}

function capitalise(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Fill the semantic fields of one record. Returns a new record; never mutates in place. */
export function draftRecord(record) {
    const stem = record.file ? basename(record.file, extname(record.file)) : record.behaviorRef;
    const category = record.tags[0] || 'action';
    const found = lookup(stem, category);
    const description = describe(record, stem, category);
    if (!found || !description) return { record, missing: stem };

    const [, , , valence] = found.entry;
    const lexiconTags = found.entry[5];
    const energy = energyOf(record, found.entry);

    // Intents the harvest already found, plus the whitelisted emotes this clip can answer.
    const intents = new Set(record.intents);
    for (const [emote, wanted] of Object.entries(WHITELIST_INTENTS)) {
        if (wanted.some((tag) => lexiconTags.includes(tag))) intents.add(emote);
    }
    // A clip that answers no whitelisted emote still has to be reachable by name — the
    // exercise pack is the case that matters, since UC-14's coach demos are selected by
    // exercise intent rather than by filename.
    if (!intents.size) intents.add(lexiconTags[0]);

    const tempo = band(TEMPO, energy);
    const tags = new Set([...record.tags, ...lexiconTags, tempo, ...(TEMPO_SYNONYMS[tempo] || [])]);
    if (band(TRAVEL, record.stats.rootMotion ?? 0)) tags.add('travels');

    return {
        record: {
            ...record,
            description,
            tags: [...tags].sort(),
            intents: [...intents].sort(),
            valence,
            energy,
        },
        missing: null,
    };
}

// ── main ─────────────────────────────────────────────────────────────────────

function readManifest() {
    return readFileSync(join(ROOT, MANIFEST), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

/**
 * Two records that read identically are two records the selector cannot tell apart, and
 * two the anti-repeat memory cannot alternate between.
 *
 * They happen honestly: `dance_1.bvh` and the `dance_1.vrma` converted from it are the
 * same motion at the same measured tempo, and `action_greeting` / `action_greeting1` are
 * two takes the filename numbers from zero. The distinguishing fact is the source, so the
 * source is what gets said.
 */
function disambiguate(records) {
    const groups = new Map();
    for (const record of records) {
        if (!groups.has(record.description)) groups.set(record.description, []);
        groups.get(record.description).push(record);
    }

    for (const group of groups.values()) {
        if (group.length < 2) continue;
        for (const record of group) {
            const source = record.file ? basename(record.file) : `the ${record.behaviorRef} behaviour`;
            record.description = `${record.description} Sourced from ${source}.`;
        }
    }
    return records;
}

export function draftAll() {
    const drafted = [];
    const missing = [];
    for (const record of readManifest()) {
        const result = draftRecord(record);
        drafted.push(result.record);
        if (result.missing) missing.push({ id: record.id, stem: result.missing });
    }
    return { drafted: disambiguate(drafted), missing };
}

/** The review ledger: what a human has signed off, and what is still waiting. */
function buildLedger(records, previous) {
    const approved = previous.approved || {};
    const pending = [];

    for (const record of records) {
        const hash = createHash('sha256').update(record.description).digest('hex').slice(0, 16);
        const signed = approved[record.id];
        if (!signed || signed.sha256 !== hash) pending.push(record.id);
    }

    return {
        $comment:
            'Review ledger for the KB descriptions. An entry means a person read that exact ' +
            'description and signed it off; the hash is the first 16 hex of sha256(description), ' +
            'so editing a line silently un-approves it. Add entries as ' +
            '{ "<id>": { "sha256": "…", "by": "…", "at": "YYYY-MM-DD" } }.',
        policy:
            'kb/scripts/validate-manifest.mjs --require-approval fails while anything is pending. ' +
            'CI does not run that flag yet: the drafts below are machine-written and have not been ' +
            'through human review, and saying so is better than a gate that quietly passes.',
        counts: { total: records.length, approved: records.length - pending.length, pending: pending.length },
        approved,
        pending: pending.sort(),
    };
}

function main() {
    const write = process.argv.includes('--write');
    const { drafted, missing } = draftAll();

    const withDescription = drafted.filter((r) => r.description).length;
    console.log(`drafted ${withDescription}/${drafted.length} descriptions`);
    if (missing.length) {
        console.log(`\n${missing.length} record(s) have no lexicon entry:`);
        for (const item of missing.slice(0, 20)) console.log(`  ${item.id} (stem: ${item.stem})`);
    }

    let previous = {};
    try {
        previous = JSON.parse(readFileSync(join(ROOT, LEDGER), 'utf8'));
    } catch {
        previous = {};
    }
    const ledger = buildLedger(drafted, previous);
    console.log(`\nreview: ${ledger.counts.approved} approved, ${ledger.counts.pending} awaiting a human`);

    if (write) {
        writeFileSync(join(ROOT, MANIFEST), drafted.map((r) => JSON.stringify(r)).join('\n') + '\n');
        writeFileSync(join(ROOT, LEDGER), JSON.stringify(ledger, null, 2) + '\n');
        console.log(`\nwrote ${MANIFEST} and ${LEDGER}`);
    } else {
        console.log('\ndry run — pass --write to update the manifest');
    }

    if (missing.length) process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith('draft-descriptions.mjs')) main();

export { WHITELIST_INTENTS, EMOTIONS, ACTIONS };
