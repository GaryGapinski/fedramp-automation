import { derived, Statemachine, statemachine } from 'overmind';

import type {
  AssertionGroup,
  AssertionView,
} from '@asap/shared/use-cases/assertion-views';
import type {
  SchematronAssert,
  FailedAssert,
} from '@asap/shared/use-cases/schematron';

import { createValidatorMachine, ValidatorMachine } from './validator-machine';

export type Role = string;

// Schematron rules meta-data
type SchematronUIConfig = {
  assertionViews: AssertionView[];
  schematronAsserts: SchematronAssert[];
};

type States =
  | {
      current: 'INITIALIZED';
    }
  | {
      current: 'UNINITIALIZED';
    };

type BaseState = {
  _assertionsById: {
    [assertionId: string]: SchematronAssert;
  };
  assertionView: AssertionView;
  config: SchematronUIConfig;
  filter: {
    role: Role;
    text: string;
    assertionViewId: number;
  };
  filterOptions: {
    assertionViews: {
      id: number;
      title: string;
    }[];
    roles: Role[];
  };
  schematronReport: {
    summary: {
      title: string;
      counts: {
        assertions: number;
        reports: number;
      };
    };
    groups: {
      title: string;
      //see: string;
      checks: {
        summary: string;
        summaryColor: 'red' | 'green';
        checks: (SchematronAssert & {
          icon: typeof checkCircleIcon;
          fired: FailedAssert[];
        })[];
      };
    }[];
  };
  _schematronChecksFiltered: SchematronAssert[];
  validator: ValidatorMachine;
};

type Events =
  | {
      type: 'CONFIG_LOADED';
      data: {
        config: SchematronUIConfig;
      };
    }
  | {
      type: 'FILTER_TEXT_CHANGED';
      data: {
        text: string;
      };
    }
  | {
      type: 'FILTER_ROLE_CHANGED';
      data: {
        role: Role;
      };
    }
  | {
      type: 'FILTER_ASSERTION_VIEW_CHANGED';
      data: {
        assertionViewId: number;
      };
    };

export type SchematronMachine = Statemachine<States, Events, BaseState>;

const checkCircleIcon = { sprite: 'check_circle', color: 'green' };
const navigateNextIcon = { sprite: 'navigate_next', color: 'blue' };
const cancelIcon = {
  sprite: 'cancel',
  color: 'red',
};

const schematronMachine = statemachine<States, Events, BaseState>({
  UNINITIALIZED: {
    CONFIG_LOADED: ({ config }) => {
      return {
        current: 'INITIALIZED',
        config,
      };
    },
  },
  INITIALIZED: {
    FILTER_TEXT_CHANGED: ({ text }, state) => {
      return {
        current: 'INITIALIZED',
        config: state.config,
        filter: {
          role: state.filter.role,
          text,
          assertionViewId: state.filter.assertionViewId,
        },
      };
    },
    FILTER_ROLE_CHANGED: ({ role }, state) => {
      return {
        current: 'INITIALIZED',
        config: state.config,
        filter: {
          role: role,
          text: state.filter.text,
          assertionViewId: state.filter.assertionViewId,
        },
      };
    },
    FILTER_ASSERTION_VIEW_CHANGED: ({ assertionViewId }, state) => {
      return {
        current: 'INITIALIZED',
        config: state.config,
        filter: {
          ...state.filter,
          assertionViewId: assertionViewId,
        },
      };
    },
  },
});

export const createSchematronMachine = () => {
  return schematronMachine.create(
    { current: 'UNINITIALIZED' },
    {
      config: {
        assertionViews: [],
        schematronAsserts: [],
      },
      _assertionsById: derived((state: SchematronMachine) => {
        const assertions: SchematronMachine['_assertionsById'] = {};
        state._schematronChecksFiltered.forEach(assert => {
          assertions[assert.id] = assert;
        });
        return assertions;
      }),
      assertionView: derived((state: SchematronMachine) => {
        if (!state.filter.assertionViewId) {
          return {
            title: 'Not specified',
            groups: [],
          };
        }
        return state.filterOptions.assertionViews
          .filter(view => view.id === state.filter.assertionViewId)
          .map(view => {
            return state.config.assertionViews[state.filter.assertionViewId];
          })[0];
      }),
      filter: {
        role: 'all',
        text: '',
        assertionViewId: 0,
      },
      filterOptions: derived((state: SchematronMachine) => {
        return {
          assertionViews: state.config.assertionViews.map((view, index) => {
            return {
              id: index,
              title: view.title,
            };
          }),
          roles: [
            'all',
            ...Array.from(
              new Set(
                state.config.schematronAsserts.map(assert => assert.role),
              ),
            ).sort(),
          ],
        };
      }),
      schematronReport: derived(
        ({
          _assertionsById,
          _schematronChecksFiltered,
          assertionView,
          validator,
        }: SchematronMachine) => {
          const isValidated = validator.current === 'VALIDATED';
          const reportCount = _schematronChecksFiltered.filter(
            c => c.isReport,
          ).length;
          return {
            summary: {
              title: isValidated
                ? 'FedRAMP Package Concerns'
                : 'FedRAMP Package Concerns (unprocessed)',
              counts: {
                assertions: _schematronChecksFiltered.length - reportCount,
                reports: reportCount,
              },
            },
            groups: assertionView.groups.map(assertionGroup => {
              type UiAssert = SchematronAssert & {
                message: string;
                icon: typeof checkCircleIcon;
                fired: FailedAssert[];
              };
              const checks = assertionGroup.assertionIds
                .map(assertionGroupAssert => {
                  const assert = _assertionsById[assertionGroupAssert];
                  if (!assert) {
                    return null;
                  }
                  const fired = validator.assertionsById[assert.id] || [];
                  return {
                    ...assert,
                    // message: `${assert.id} ${assert.message}`,
                    icon: !isValidated
                      ? navigateNextIcon
                      : fired.length
                      ? cancelIcon
                      : checkCircleIcon,
                    fired,
                  };
                })
                .filter(
                  (assert: UiAssert | null): assert is UiAssert =>
                    assert !== null,
                );
              const firedCount = checks.filter(
                assert => assert.fired.length > 0,
              ).length;
              return {
                title: assertionGroup.title,
                checks: {
                  summary: (() => {
                    if (isValidated) {
                      return `${firedCount} / ${checks.length} triggered`;
                    } else {
                      return `${checks.length} checks`;
                    }
                  })(),
                  summaryColor: firedCount === 0 ? 'green' : 'red',
                  checks,
                },
              };
            }),
          };
        },
      ),
      _schematronChecksFiltered: derived(
        ({ config, filter, filterOptions }: SchematronMachine) => {
          const filterRoles =
            filter.role === 'all' ? filterOptions.roles : filter.role;
          let assertions = config.schematronAsserts.filter(
            (assertion: SchematronAssert) => {
              return filterRoles.includes(assertion.role || '');
            },
          );
          if (filter.text.length > 0) {
            assertions = assertions.filter(assert => {
              const searchText = assert.message.toLowerCase();
              return searchText.includes(filter.text.toLowerCase());
            });
          }
          return assertions;
        },
      ),
      validator: createValidatorMachine(),
    },
  );
};
