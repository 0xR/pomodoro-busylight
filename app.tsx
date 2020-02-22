import fs from 'fs-extra';
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
// @ts-ignore
import { UncontrolledTextInput } from 'ink-text-input';
import { formatMillis, formatTime, getProgress, PomodoroContext } from "./lib";

const busylight = getBusylight();

const blinkingRate = 500;
busylight.defaults({
  rate: blinkingRate,
});

const debug = process.env.npm_lifecyle_event === 'dev';

const workColor = 'red';
const breakColor = 'green';
const meetingColor = 'blue';
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
          CONFIGMEETINGS: 'configMeetings',
          MEETING: 'meeting',
          EXIT: 'exit',
        },
        activities: 'setIdleLight',
      },
      work: {
        on: {
          FINISHED: 'workFinished',
          STOP: 'idle',
          MEETING: 'meeting',
        },
        entry: 'setStartTime',
        activities: 'setBusylight',
      },
      workFinished: {
        on: {
          BREAK: 'break',
          STOP: 'idle',
          MEETING: 'meeting',
        },
        activities: 'setReadyForBreakLight',
      },
      break: {
        on: {
          FINISHED: 'breakFinished',
          STOP: 'idle',
          MEETING: 'meeting',
        },
        entry: 'setStartTime',
        activities: 'setBreaklight',
      },
      breakFinished: {
        on: {
          WORK: 'work',
          STOP: 'idle',
          MEETING: 'meeting',
        },
        activities: 'setReadyForWorkLight',
      },
      configMeetings: {
        on: {
          STOP: 'idle',
        },
        activities: 'setConfigMeetingLight',
      },
      meeting: {
        on: {
          STOP: 'idle',
        },
        activities: 'setMeetingLight',
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
      setConfigMeetingLight: () => {
        busylight.pulse(meetingColor);
        return () => busylight.off();
      },
      setMeetingLight: () => {
        busylight.light(meetingColor);
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

function formatMeetings(
  meetings: Meeting[],
  currentTime: number,
  meetingError: Error | undefined,
) {
  const formattedMeetings = meetings.map(m => {
    const meetingDate = new Date(m);
    return `${formatMillis(m - currentTime)} (${formatTime(meetingDate)})`;
  });

  const currentDate = new Date(currentTime);

  return `Meetings: ${
    meetings.length ? formattedMeetings.join(', ') : 'none'
  } - Time: ${formatTime(currentDate)}${
    meetingError ? ' ' + meetingError.toString() : ''
  }`;
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

function usePersistedState<T>(
  initialState: T,
  path: string,
): [T, (state: T) => void, Error | undefined] {
  const [state, setState] = useState(initialState);
  const [error, setError] = useState<Error | undefined>(undefined);

  useEffect(() => {
    (async () => {
      try {
        const storedState = await fs.readJSON(path);
        setState(storedState);
      } catch (e) {
        setError(e);
      }
    })();
  }, []);
  async function storeState(newState: T) {
    setState(newState);
    try {
      await fs.writeJSON(path, newState);
    } catch (e) {
      setError(e);
    }
  }

  return [state, storeState, error];
}

const useMeetings = ({
  meetings,
  onChangeMeetings,
}: {
  meetings: Meeting[];
  onChangeMeetings: (meetings: Meeting[]) => void;
}) => {
  const [error, setError] = useState<string>('');
  return {
    error,
    addMeeting(input: string) {
      const parsed = parseInt(input, 10);
      if (!parsed) {
        setError(`Not a number "${input}"`);
        return;
      }
      const hours = Math.floor(parsed / 100);
      const min = parsed % 100;
      if (0 > hours || hours > 23) {
        setError(`Invalid hour "${input}"`);
        return;
      }
      if (0 > min || min > 59) {
        setError(`Invalid minute "${input}"`);
        return;
      }
      setError('');
      const meetingDate = new Date();
      meetingDate.setHours(hours, min, 0, 0);
      const newMeeting = meetingDate.getTime();
      if (newMeeting <= Date.now()) {
        setError(`In the passed: "${input}"`);
        return;
      }
      const result = [...meetings, newMeeting];
      result.sort();
      onChangeMeetings(result);
    },
    removeMeeting(toRemove: Meeting) {
      onChangeMeetings(meetings.filter(meeting => meeting != toRemove));
    },
  };
};

type Meeting = number;

const ConfigMeetings = ({
  meetings,
  onChangeMeetings,
  onDone,
}: {
  meetings: Meeting[];
  onChangeMeetings: (meetings: Meeting[]) => void;
  onDone: () => void;
}) => {
  const [state, setState] = useState<'home' | 'add' | 'remove'>('home');
  const { error, addMeeting, removeMeeting } = useMeetings({
    meetings,
    onChangeMeetings,
  });

  return (
    <>
      {error && <Text>{error}</Text>}
      {state === 'home' ? (
        <SelectInput
          items={[
            {
              label: 'Add meeting',
              value: 'add',
            },
            {
              label: 'remove',
              value: 'remove',
            },
            {
              label: 'exit',
              value: 'exit',
            },
          ]}
          onSelect={(item: Item) => {
            if (item.value === 'add') {
              setState('add');
            }
            if (item.value === 'remove') {
              setState('remove');
            }
            if (item.value === 'exit') {
              onDone();
            }
          }}
        />
      ) : state === 'remove' ? (
        <SelectInput
          items={[
            ...meetings.map(meeting => ({
              label: meeting.toString(),
              value: meeting,
            })),
            {
              label: 'Back',
              value: 'back',
            },
          ]}
          onSelect={(item: Item) => {
            if (item.value === 'back') {
              setState('home');
            } else {
              removeMeeting(item.value as number);
            }
          }}
        />
      ) : (
        <Box>
          <Box marginRight={1}>Enter meeting time:</Box>
          <UncontrolledTextInput
            onSubmit={value => {
              addMeeting(value);
              setState('home');
            }}
          />
        </Box>
      )}
    </>
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

  const [meetings, setMeetings, meetingError] = usePersistedState<Meeting[]>(
    [],
    `${process.env.HOME}/.pomodoro.json`,
  );

  useEffect(() => {
    if (progress && progress.percent <= 0) {
      send({
        type: 'FINISHED',
      });
    }
  }, [progress]);

  useEffect(() => {
    if (currentTime > meetings[0]) {
      setMeetings(meetings.slice(1));
      send({
        type: 'MEETING',
      });
    }
  }, [currentTime, meetings[0]]);

  const timePassedText = progress ? formatMillis(progress.millis) : '';
  return (
    <>
      <Header
        currentTime={currentTime}
        mode={
          state === 'work' || state === 'break' || state === 'meeting'
            ? 'progress'
            : 'blinking'
        }
        color={
          state === 'work' || state === 'breakFinished'
            ? workColor
            : state === 'break' || state === 'workFinished'
            ? breakColor
            : state === 'meeting' || state === 'configMeetings'
            ? meetingColor
            : idleColor
        }
      />
      <Text>{formatMeetings(meetings, currentTime, meetingError)}</Text>
      {state === 'configMeetings' ? (
        <ConfigMeetings
          meetings={meetings}
          onChangeMeetings={meetings => {
            setMeetings(meetings);
          }}
          onDone={() => {
            send({
              type: 'STOP',
            });
          }}
        />
      ) : (
        <>
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
              .filter(eventType => eventType !== 'MEETING')
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
      )}
    </>
  );
};

const { unmount } = render(<PomodoroTimer />);
