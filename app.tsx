import fs from 'fs-extra';
// @ts-ignore
import { get as getBusylight } from 'busylight';
import { assign, EventObject, Machine, StateConfig } from 'xstate';
import { useMachine } from '@xstate/react';
import { Box, Color, render, Text } from 'ink';
import SelectInput, { Item } from 'ink-select-input';
import React, { ReactElement, useEffect, useRef, useState } from 'react';
// @ts-ignore
import ProgressBar from 'ink-progress-bar';
// @ts-ignore
import BigText from 'ink-big-text';
// @ts-ignore
import { UncontrolledTextInput } from 'ink-text-input';
import { formatMillis, formatTime, getProgress, PomodoroContext } from './lib';
import { useDebouncedCallback } from 'use-debounce';
import winston, { format } from 'winston';
import { parse, stringify } from 'flatted';

const logger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss.SSS',
    }),
    format.splat(),
    format.printf(info => {
      return `${info.timestamp} ${info.message}`;
    }),
  ),
  transports: [
    new winston.transports.File({
      filename: 'debug.log',
      level: 'debug',
      handleExceptions: true,
    }),
  ],
});

logger.debug('#### new run ####');

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

const pomodoroMachine = Machine<PomodoroContext, EventObject>(
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
          FINISHED: 'breakFinished',
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
      configMeetings: {
        on: {
          STOP: 'idle',
        },
        activities: 'setConfigMeetingLight',
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
        startTime: (_context, _event) => Date.now(),
      }),
    },
  },
);

const meetingMachine = Machine<{}, EventObject>(
  {
    id: 'meeting',
    initial: 'idle',
    strict: true,
    states: {
      idle: {
        on: {
          CONFIGMEETINGS: 'configMeetings',
          MEETING: 'meeting',
        },
        activities: 'setIdleLight',
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
    },
  },
  {
    activities: {
      setConfigMeetingLight: () => {
        busylight.pulse(meetingColor);
        return () => busylight.off();
      },
      setMeetingLight: () => {
        busylight.light(meetingColor);
        return () => busylight.off();
      },
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

function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<undefined | T>();
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}

interface PersistState {
  meetings: Meeting[];
  meetingState: StateConfig<{}, EventObject> | undefined;
  pomodoroState: StateConfig<PomodoroContext, EventObject> | undefined;
}

function usePersistedState<T>(
  initialState: T,
  path: string,
): [T | 'loading', (state: Partial<T>) => void, Error | undefined] {
  const [state, setState] = useState<T | 'loading'>('loading');
  const [error, setError] = useState<Error | undefined>(undefined);

  useEffect(() => {
    (async () => {
      try {
        if (await fs.pathExists(path)) {
          const storedState = parse(await fs.readFile(path, 'UTF-8'));
          setState(storedState);
        } else {
          setState(initialState);
        }
      } catch (e) {
        setError(e);
      }
    })();
  }, []);

  const [writeState] = useDebouncedCallback(async () => {
    logger.debug(`Wrote: %s`, stringify(state));
    try {
      await fs.writeFile(path, stringify(state));
    } catch (e) {
      setError(e);
    }
  }, 200);

  async function setAndWriteState(newStateSlice: Partial<T>) {
    const newState = {
      ...(state === 'loading' ? initialState : state),
      ...newStateSlice,
    };
    setState(newState);
    await writeState();
  }

  return [state, setAndWriteState, error];
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
              label: formatTime(new Date(meeting)),
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

interface PomodoroStateRenderProps {
  persistedState: PersistState;
  setPersistedState: (state: Partial<PersistState>) => void;
  persistError: Error | undefined;
}

const PomodoroTimer = ({
  persistedState,
  setPersistedState,
  persistError,
}: PomodoroStateRenderProps): ReactElement => {
  const currentTime = useTime();
  const [pomodoroMachineState, sendPomodoro] = useMachine(pomodoroMachine, {
    state: {
      ...persistedState.pomodoroState,
      configuration: [],
    } as StateConfig<PomodoroContext, EventObject>,
  });

  const [meetingMachineState, sendMeeting] = useMachine(meetingMachine, {
    state: { ...persistedState.meetingState, configuration: [] } as StateConfig<
      {},
      EventObject
    >,
  });

  const { context, nextEvents: pomodoroNextEvents } = pomodoroMachineState;
  const { nextEvents: meetingNextEvents } = meetingMachineState;

  const nextEvents = [...pomodoroNextEvents, ...meetingNextEvents];
  const pomodoroState = pomodoroMachineState.value.toString();
  const previousPomodoroState = usePrevious(pomodoroState);
  const meetingState = meetingMachineState.value.toString();
  const previousMeetingState = usePrevious(meetingState);

  useEffect(() => {
    logger.debug('persistedState changed %s', stringify(persistedState));
  }, [persistedState]);

  useEffect(() => {
    logger.debug(
      'pomodoroState changed %s => %s',
      previousPomodoroState,
      pomodoroState,
    );
    setPersistedState({
      pomodoroState: pomodoroMachineState,
    });
  }, [pomodoroState]);

  useEffect(() => {
    logger.debug(
      'meetingState changed %s => %s ',
      previousMeetingState,
      meetingState,
    );
    setPersistedState({
      meetingState: meetingMachineState,
    });
  }, [meetingState]);

  useEffect(() => {
    if (pomodoroState === 'exit') {
      unmount();
    }
  }, [pomodoroState]);

  const progress = getProgress({
    state: pomodoroState,
    context,
    currentTime,
  });

  const { meetings } = persistedState;

  useEffect(() => {
    if (progress && progress.percent <= 0) {
      sendPomodoro({
        type: 'FINISHED',
      });
    }
  }, [progress]);

  useEffect(() => {
    if (currentTime > meetings[0]) {
      setPersistedState({ meetings: meetings.slice(1) });
      sendMeeting({
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
          pomodoroState === 'work' ||
          pomodoroState === 'break' ||
          pomodoroState === 'meeting'
            ? 'progress'
            : 'blinking'
        }
        color={
          pomodoroState === 'work' || pomodoroState === 'breakFinished'
            ? workColor
            : pomodoroState === 'break' || pomodoroState === 'workFinished'
            ? breakColor
            : meetingState === 'meeting' || meetingState === 'configMeetings'
            ? meetingColor
            : idleColor
        }
      />
      <Text>{formatMeetings(meetings, currentTime, persistError)}</Text>
      {meetingState === 'configMeetings' ? (
        <ConfigMeetings
          meetings={meetings}
          onChangeMeetings={meetings => {
            setPersistedState({ meetings });
          }}
          onDone={() => {
            sendMeeting({
              type: 'STOP',
            });
          }}
        />
      ) : (
        <>
          {progress && (
            <Color keyword={pomodoroState === 'work' ? workColor : breakColor}>
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
              if (item.value === 'CONFIGMEETINGS') {
                sendMeeting({
                  type: item.value.toString(),
                });
              } else {
                sendPomodoro({
                  type: item.value.toString(),
                });
              }
            }}
          />
        </>
      )}
    </>
  );
};

const PomodoroState = ({
  children,
}: {
  children: ({
    persistedState,
    setPersistedState,
    persistError,
  }: PomodoroStateRenderProps) => ReactElement;
}): ReactElement => {
  const [persistedState, setPersistedState, persistError] = usePersistedState<
    PersistState
  >(
    {
      meetings: [],
      pomodoroState: undefined,
      meetingState: undefined,
    },
    `${process.env.HOME}/.pomodoro.json`,
  );

  if (persistedState === 'loading') {
    return <Text>Loading state from file...</Text>;
  }
  return children({ persistedState, setPersistedState, persistError });
};

const { unmount } = render(
  <PomodoroState>
    {renderProps => <PomodoroTimer {...renderProps} />}
  </PomodoroState>,
);
