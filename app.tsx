// @ts-ignore
import { get as getBusylight } from 'busylight';
import { assign, EventObject, Machine } from 'xstate';
import { useMachine } from '@xstate/react';
import { Box, Color, render, Text } from 'ink';
import SelectInput, { Item } from 'ink-select-input';
import React, { useEffect, useState } from 'react';
// @ts-ignore
import ProgressBar from 'ink-progress-bar';
// @ts-ignore
import BigText from 'ink-big-text';

const busylight = getBusylight();

const blinkingRate = 500;
busylight.defaults({
  rate: blinkingRate,
});

interface PomodoroContext {
  workDuration: number;
  breakDuration: number;
  startTime?: Date;
}

const debug = process.env.npm_lifecyle_event === 'dev';

const SECOND = 1000;
const MINUTE = debug ? SECOND : SECOND * 60;
const workColor = 'red';
const breakColor = 'green';
const idleColor = 'orange';

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
        busylight.pulse(idleColor);
        return () => busylight.off();
      },
      setReadyForWorkLight: () => {
        busylight.pulse(workColor);
        return () => busylight.off();
      },
      setBusylight: () => {
        busylight.light(workColor);
        return () => busylight.off();
      },
      setReadyForBreakLight: () => {
        busylight.pulse(breakColor);
        return () => busylight.off();
      },
      setBreaklight: () => {
        busylight.light(breakColor);
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
    }, 1000);

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
      const difference = currentTime - startTime.getTime();
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

function pad(num: number, size: number) {
  var s = '000000000' + num;
  return s.substr(s.length - size);
}

function formatMillis(millis: number) {
  return `${pad(Math.floor(millis / MINUTE), 2)}:${pad(
    Math.floor((millis % MINUTE) / SECOND),
    2,
  )}`;
}

const Header = ({
  currentTime,
  mode,
  color,
}: {
  currentTime: number;
  mode: 'blinking' | 'progress';
  color: string;
}) => {
  const texts = ['PO', 'MO', 'DO', 'RO'];
  const rateCount = Math.round(currentTime / (2 * blinkingRate));
  const highlightColor = 'white';
  const colors =
    mode === 'blinking'
      ? rateCount % 2
        ? Array(texts.length).fill(highlightColor)
        : Array(texts.length).fill(color)
      : texts.map((text, i) => {
          return rateCount % texts.length === i ? highlightColor : color;
        });
  return (
    <Box>
      {texts.map((text, i) => (
        <Box key={i} marginLeft={i && -1}>
          <Color keyword={colors[i]}>
            <BigText text={text} />
          </Color>
        </Box>
      ))}
    </Box>
  );
};

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
    if (progress && progress.percent <= 0) {
      send({
        type: 'FINISHED',
      });
    }
  }, [progress]);

  const timePassedText = progress ? formatMillis(progress.millis) : '';
  return (
    <>
      <Header
        currentTime={currentTime}
        mode={state === 'work' || state === 'break' ? 'progress' : 'blinking'}
        color={
          state === 'work' || state === 'breakFinished'
            ? workColor
            : state === 'break' || state === 'workFinished'
            ? breakColor
            : idleColor
        }
      />
      {progress && (
        <Color keyword={state === 'work' ? workColor : breakColor}>
          <Box>
            <Box marginRight={1}>{timePassedText}</Box>
            <ProgressBar
              left={timePassedText.length + 1}
              percent={progress?.percent}
            />
          </Box>
        </Color>
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
