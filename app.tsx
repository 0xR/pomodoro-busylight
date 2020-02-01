// @ts-ignore
import { get as getBusylight } from 'busylight';
import { assign, EventObject, interpret, Machine, Sender } from 'xstate';
import { DoneInvokeEvent } from 'xstate/lib/types';
import { useMachine } from '@xstate/react';
import { render, Text } from 'ink';
import SelectInput, { Item } from 'ink-select-input';
import React, { useEffect } from 'react';

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
  return () => {
    let resolve: ((value: string) => void) | null = null;

    render(
      <SelectInput
        items={transitions.map(transition => ({
          label: `Go to ${transition}`,
          value: transition,
        }))}
        onSelect={(item: Item) => {
          if (resolve) {
            resolve(item.value as string);
          }
        }}
      />,
    );

    return new Promise(_resolve => {
      resolve = _resolve;
    });
  };
}

function createOnDone(transitions: string[]) {
  return transitions.map(transition => ({
    target: transition,
    cond: (context: any, event: DoneInvokeEvent<string>) => {
      return event.data === transition;
    },
  }));
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
        on: {
          WORK: 'work',
          BREAK: 'break',
          EXIT: 'exit',
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

const PomodoroTimer = () => {
  const [current, send] = useMachine(machine);
  useEffect(() => {
    if (current.value === 'exit') {
      unmount();
    }
  }, [current.value]);
  return (
    <>
      <Text>Current state: {current.value}</Text>
      <SelectInput
        items={current.nextEvents
          .filter(eventType => eventType !== 'TICK')
          .map(eventType => ({
            label: `Go to ${eventType}`,
            value: eventType,
          }))}
        onSelect={(item: Item) => {
          send({
            type: item.value.toString(),
          });
        }}
      />
    </>
  );
};

const { unmount } = render(<PomodoroTimer />);
