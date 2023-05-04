import { exec as execCb } from 'child_process';
import util from 'util';

const exec = util.promisify(execCb);

const SECOND = 1000;
const MINUTE = SECOND * 60;

export function pad(num: number, size: number) {
  if (num >= 10 ** size) {
    return num;
  }
  var s = '000000000' + num;
  return s.substr(s.length - size);
}

export function formatMillis(millis: number) {
  return `${pad(Math.floor(millis / MINUTE), 2)}:${pad(
    Math.floor((millis % MINUTE) / SECOND),
    2,
  )}`;
}

export function formatTime(date: Date) {
  return `${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}`;
}

export interface PomodoroContext {
  workDuration: number;
  breakDuration: number;
  startTime?: number;
}

export function getProgress({
  state,
  context: { workDuration, breakDuration, startTime },
  currentTime,
}: {
  state: string;
  context: PomodoroContext;
  currentTime: number;
}) {
  if (state === 'work' || state === 'break') {
    const duration = state === 'work' ? workDuration : breakDuration;
    if (startTime) {
      const difference = currentTime - startTime;
      const minutesPassed = difference / MINUTE;
      return {
        millis: duration * MINUTE - difference,
        percent: Math.max(1 - minutesPassed / duration, 0),
      };
    }
  } else {
    return undefined;
  }
}

export async function alert(text: string) {
  await exec(`bash alert.sh "${text}"`);
}

export async function alertWithSound(text: string) {
  await Promise.all([
    exec(`bash alert.sh "${text}"`),
    exec('play electronic_buzzer.ogg'),
  ]);
}
