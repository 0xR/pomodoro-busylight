// @ts-ignore
import { get as getBusylight } from 'busylight';
import { assign, EventObject, interpret, Machine, Sender } from 'xstate';
import prompts from 'prompts';
import { DoneInvokeEvent, TransitionConfig } from 'xstate/lib/types';

const busylight = getBusylight();

busylight.defaults({
  rate: 500,
});

interface PomodoroContext {
  workDuration: number;
  breakDuration: number;
  startTime?: Date;
}

const idleTransitions = ['work', 'break', 'exit'];

function createPrompt(transitions: string[]) {
  return () =>
    prompts({
      type: 'select',
      name: 'answer',
      message: 'What to do?',
      choices: transitions.map(transition => ({
        title: `Go to ${transition}`,
        value: transition,
      })),
    });
}

function createOnDone(transitions: string[]) {
  return transitions.map(transition => ({
    target: transition,
    cond: (context: any, event: DoneInvokeEvent<{ answer: string }>) =>
      event.data.answer === transition,
  }));
}

function askToStop(onStop: () => void) {
  prompts({
    type: 'confirm',
    message: 'Stop current session?',
    name: 'stop',
  }).then(({ stop }) => (stop ? onStop() : askToStop(onStop)));
}

function createTimerState({
  getDuration,
  target,
  activity,
}: {
  getDuration: (contest: PomodoroContext) => number;
  target: string;
  activity: string;
}) {
  return {
    invoke: {
      src: () => (cb: Sender<any>) => {
        const interval = setInterval(() => {
          cb('TICK');
        }, 1000);

        askToStop(() => cb('STOP'));

        return () => {
          clearInterval(interval);
        };
      },
    },
    on: {
      TICK: {
        target,
        cond: (context: PomodoroContext) => {
          const { startTime } = context;
          const duration = getDuration(context);
          return (
            !!startTime &&
            (Date.now() - startTime.getTime()) / MINUTE >= duration
          );
        },
      },
      STOP: 'idle',
    },
    entry: 'setStartTime',
    activities: activity,
  };
}

const debug = process.env.npm_lifecyle_event === 'dev';

const MINUTE = debug ? 1000 : 1000 * 60;

const workFinishedPrompts = ['break', 'idle'];
const breakFinishedPrompts = ['work', 'idle'];

const machine = Machine<PomodoroContext, EventObject>(
  {
    id: 'pomodoro',
    initial: 'idle',
    strict: true,
    context: { workDuration: debug ? 5 : 25, breakDuration: 5 },
    states: {
      idle: {
        invoke: {
          src: createPrompt(idleTransitions),
          onDone: createOnDone(idleTransitions),
        },
        activities: 'setIdleLight',
      },
      work: createTimerState({
        getDuration: ({ workDuration }) => workDuration,
        target: 'workFinished',
        activity: 'setBusylight',
      }),
      workFinished: {
        invoke: {
          src: createPrompt(workFinishedPrompts),
          onDone: createOnDone(workFinishedPrompts),
        },
        activities: 'setReadyForBreakLight',
      },
      break: createTimerState({
        getDuration: ({ breakDuration }) => breakDuration,
        target: 'breakFinished',
        activity: 'setBreaklight',
      }),
      breakFinished: {
        invoke: {
          src: createPrompt(breakFinishedPrompts),
          onDone: createOnDone(breakFinishedPrompts),
        },
        activities: 'setReadyForWorkLight',
      },
      exit: {
        type: 'final',
      },
    },
  },
  {
    activities: {
      setIdleLight: () => {
        busylight.pulse('orange');
        return () => busylight.off();
      },
      setReadyForWorkLight: () => {
        busylight.pulse('red');
        return () => busylight.off();
      },
      setBusylight: () => {
        busylight.light('red');
        return () => busylight.off();
      },
      setReadyForBreakLight: () => {
        busylight.pulse('green');
        return () => busylight.off();
      },
      setBreaklight: () => {
        busylight.light('green');
        return () => busylight.off();
      },
    },
    actions: {
      setStartTime: assign({
        startTime: (context, event) => new Date(),
      }),
    },
  },
);

(async () => {
  await new Promise(resolve => {
    interpret(machine, {
      execute: true,
    })
      .onTransition((state, event) => {
        if (debug) {
          console.log('onTransition', state.value, event, state.context);
        }
      })
      .onDone(resolve)
      .start();
  });
  // TODO: Figure out a better way:
  process.exit()
})();
