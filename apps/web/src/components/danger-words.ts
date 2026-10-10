export type DangerAction = 'delete' | 'clear' | 'start-over'

/** What Clear history and Start over say they do (sk-8won); the Advanced settings dialogs use the same words. */
export const CLEAR_GOES = 'The conversation and its history are deleted; the robot starts a fresh conversation.'
export const CLEAR_STAYS = 'Its settings, grants, routines, connections and all its files stay.'
export const START_OVER_GOES = 'The conversation and its history are deleted, and every file in its workspace goes back to the templates: persona, memory, daily notes, skills and anything it made.'
export const START_OVER_STAYS = 'Its settings, grants, routines and connections stay. The product docs stay.'
