// Original compositions for the game's synth: dark, slow-burning 80s-style pieces in minor keys.
// Lead phrases: one string per bar, tokens "degree:length" in 16th notes ("-" = rest). Degrees index the scale (7 = octave up).
export interface Song {
  title: string; bpm: number; root: number; scale: number[];
  /** chord roots (scale degrees) per bar for the verse and the chorus */
  prog: [number[], number[]];
  bass: 'eighth' | 'gallop' | 'sixteenth' | 'half'; drums: 'four' | 'half'; arp: 8 | 16;
  lead: [string[], string[]];
}
const MINOR = [0, 2, 3, 5, 7, 8, 10], DORIAN = [0, 2, 3, 5, 7, 9, 10], PHRYG = [0, 1, 4, 5, 7, 8, 10];

export const SONGS: Record<string, Song> = {
  title: {
    title: 'Night Signal', bpm: 92, root: 45, scale: MINOR, prog: [[0, 5, 2, 6], [3, 5, 6, 0]], bass: 'eighth', drums: 'four', arp: 16,
    lead: [['4:6 2:2 4:8', '5:6 4:2 2:8', '4:6 6:2 4:8', '3:4 1:4 -:8'], ['7:8 5:4 3:4', '9:8 7:8', '8:6 6:2 8:4 10:4', '9:12 -:4']],
  },
  showroom: {
    title: 'Chrome', bpm: 84, root: 50, scale: DORIAN, prog: [[0, 3, 0, 6], [5, 6, 0, 0]], bass: 'half', drums: 'half', arp: 8,
    lead: [['-:4 4:4 7:8', '-:4 3:4 5:8', '-:4 4:4 2:8', '1:8 -:8'], ['9:8 7:8', '8:8 6:8', '7:4 9:4 11:8', '-:16']],
  },
  results: {
    title: 'Afterglow', bpm: 88, root: 52, scale: MINOR, prog: [[0, 5, 2, 6], [5, 6, 0, 0]], bass: 'half', drums: 'half', arp: 8,
    lead: [['4:8 7:8', '5:8 9:8', '6:8 4:8', '3:12 -:4'], ['9:12 7:4', '8:12 6:4', '7:8 4:8', '7:16']],
  },
  brazil: {
    title: 'Neon Tropic', bpm: 108, root: 42, scale: MINOR, prog: [[0, 5, 2, 6], [3, 6, 0, 0]], bass: 'gallop', drums: 'four', arp: 16,
    lead: [['4:3 4:3 2:2 4:8', '5:3 5:3 4:2 2:8', '6:3 6:3 4:2 6:8', '4:4 3:4 1:8'], ['7:6 9:2 7:8', '8:6 10:2 8:8', '9:4 7:4 4:8', '7:12 -:4']],
  },
  usa: {
    title: 'Black Highway', bpm: 112, root: 40, scale: MINOR, prog: [[0, 0, 5, 6], [2, 6, 5, 6]], bass: 'sixteenth', drums: 'four', arp: 8,
    lead: [['7:2 -:2 7:4 6:4 4:4', '7:2 -:2 7:4 9:8', '5:4 7:4 9:8', '8:6 6:2 4:8'], ['9:8 11:8', '10:8 8:8', '9:8 7:8', '8:4 6:4 8:8']],
  },
  japan: {
    title: 'Tokyo Rain', bpm: 116, root: 49, scale: MINOR, prog: [[0, 5, 3, 6], [5, 6, 0, 2]], bass: 'eighth', drums: 'four', arp: 16,
    lead: [['4:4 7:4 8:8', '9:4 7:4 5:8', '7:4 5:4 3:8', '6:6 4:2 3:8'], ['11:6 9:2 7:8', '9:6 8:2 6:8', '7:6 9:2 11:8', '10:8 9:8']],
  },
  norway: {
    title: 'Polar Night', bpm: 96, root: 50, scale: MINOR, prog: [[0, 6, 5, 6], [2, 6, 0, 5]], bass: 'eighth', drums: 'half', arp: 16,
    lead: [['0:8 2:4 4:4', '6:8 4:8', '5:8 7:4 9:4', '8:12 -:4'], ['9:8 6:8', '8:8 6:4 4:4', '7:8 4:8', '5:8 4:8']],
  },
  italy: {
    title: 'Velluto Nero', bpm: 104, root: 43, scale: MINOR, prog: [[0, 3, 6, 2], [5, 6, 4, 0]], bass: 'gallop', drums: 'four', arp: 8,
    lead: [['7:6 6:2 4:8', '5:6 3:2 5:8', '6:6 8:2 10:8', '9:8 6:8'], ['9:4 7:4 5:8', '10:4 8:4 6:8', '8:4 6:4 4:8', '4:4 2:4 0:8']],
  },
  uk: {
    title: 'Fog Lights', bpm: 90, root: 47, scale: DORIAN, prog: [[0, 6, 3, 0], [3, 0, 6, 6]], bass: 'eighth', drums: 'half', arp: 8,
    lead: [['-:8 4:4 7:4', '-:8 6:4 8:4', '-:8 5:4 7:4', '4:8 2:8'], ['7:8 9:8', '7:8 4:8', '8:8 6:8', '10:8 8:8']],
  },
  egypt: {
    title: 'Mirage', bpm: 100, root: 50, scale: PHRYG, prog: [[0, 1, 0, 6], [3, 1, 0, 0]], bass: 'gallop', drums: 'four', arp: 16,
    lead: [['0:6 1:2 2:8', '1:6 2:2 3:8', '4:6 2:2 1:8', '0:12 -:4'], ['7:6 8:2 9:8', '8:6 9:2 10:8', '7:4 5:4 4:8', '2:4 1:4 0:8']],
  },
  australia: {
    title: 'Dust Devil', bpm: 118, root: 45, scale: MINOR, prog: [[0, 6, 5, 6], [5, 6, 0, 0]], bass: 'sixteenth', drums: 'four', arp: 8,
    lead: [['4:4 4:2 7:2 4:8', '6:4 6:2 8:2 6:8', '5:4 5:2 7:2 9:8', '8:8 6:8'], ['11:8 9:8', '10:8 8:8', '9:4 7:4 4:8', '7:12 -:4']],
  },
  midnight: {
    title: 'Midnight Lanes', bpm: 86, root: 41, scale: MINOR, prog: [[0, 5, 3, 4], [5, 6, 0, 0]], bass: 'half', drums: 'half', arp: 16,
    lead: [['-:4 2:4 4:8', '-:4 5:4 7:8', '-:4 3:4 5:8', '4:8 6:8'], ['9:8 7:8', '9:8 5:8', '7:8 9:4 11:4', '11:16']],
  },
};
/** Songs offered in the jukebox for races. */
export const RACE_SONGS = ['brazil', 'usa', 'japan', 'norway', 'italy', 'uk', 'egypt', 'australia', 'midnight'];
