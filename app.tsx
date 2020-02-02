// @ts-ignore
import { get as getBusylight } from 'busylight';
import { assign, EventObject, Machine } from 'xstate';
import { useMachine } from '@xstate/react';
import { Box, render, Text } from 'ink';
import SelectInput, { Item } from 'ink-select-input';
import React, { useEffect, useState } from 'react';
// @ts-ignore
import ProgressBar from 'ink-progress-bar';

const busylight = getBusylight();

busylight.defaults({
  rate: 500,
});

interface PomodoroContext {
  workDuration: number;
  breakDuration: number;
  startTime?: Date;
}

const debug = process.env.npm_lifecyle_event === 'dev';

const SECOND = 1000;
const MINUTE = debug ? SECOND : SECOND * 60;

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
      work: {
        on: {
          FINISHED: 'workFinished',
          STOP: 'idle',
        },
        entry: 'setStartTime',
        activities: 'setBusylight',
      },
      workFinished: {
        on: {
          BREAK: 'break',
          STOP: 'idle',
        },
        activities: 'setReadyForBreakLight',
      },
      break: {
        on: {
          FINISHED: 'workFinished',
          STOP: 'idle',
        },
        entry: 'setStartTime',
        activities: 'setBreaklight',
      },
      breakFinished: {
        on: {
          WORK: 'work',
          STOP: 'idle',
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

const useTime = () => {
  const [time, setTime] = useState<number>(Date.now());
  useEffect(() => {
    const interval = setInterval(() => {
      setTime(Date.now());
    }, 100);

    return () => {
      clearInterval(interval);
    };
  }, []);
  return time;
};

function getProgress({
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
      const difference = Math.max(currentTime - startTime.getTime(), 0);
      const minutesPassed = difference / MINUTE;
      return {
        millis: difference,
        percent: minutesPassed / duration,
      };
    }
  } else {
    return undefined;
  }
}

function pad(num: number, size: number) {
  var s = '000000000' + num;
  return s.substr(s.length - size);
}

function formatMillis(millis: number) {
  return `${pad(Math.floor(millis / MINUTE), 2)}:${pad(
    Math.round((millis % MINUTE) / SECOND),
    2,
  )}`;
}

const PomodoroTimer = () => {
  const currentTime = useTime();
  const [currentState, send] = useMachine(machine);
  const { context, nextEvents } = currentState;

  const state = currentState.value.toString();

  useEffect(() => {
    if (state === 'exit') {
      unmount();
    }
  }, [state]);

  const progress = getProgress({
    state,
    context,
    currentTime,
  });

  useEffect(() => {
    if (progress && progress.percent >= 1) {
      send({
        type: 'FINISHED',
      });
    }
  }, [progress]);

  const timePassedText = progress ? formatMillis(progress.millis) : '';
  return (
    <>
      <Text>Current state: {state}</Text>
      {progress && (
        <Box>
          <Box marginRight={1}>{timePassedText}</Box>
          <ProgressBar
            left={timePassedText.length + 1}
            percent={progress?.percent}
          />
        </Box>
      )}
      <SelectInput
        items={nextEvents
          .filter(eventType => eventType !== 'FINISHED')
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
