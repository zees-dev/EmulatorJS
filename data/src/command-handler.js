/**
 * @fileoverview Centralized operation handler for EmulatorJS
 * Routes emulator operations through a single interface for easy extension
 * @module EJS_CommandHandler
 */

/**
 * Handles emulator operations through a unified interface
 * Supports custom command overrides via window.EJS_commands
 * Supports operation callbacks via window.EJS_onCommand
 * Supports init operations via window.EJS_initCommands
 * @class
 */
class EJS_CommandHandler {
    /**
     * @param {EmulatorJS} emulator - EmulatorJS instance
     * @param {Object} [config] - Configuration object
     */
    constructor(emulator, config = {}) {
        this.emulator = emulator;
        this.config = this.validateConfig(config.handlerConfig || {});
        this.commands = this.buildCommandOptions(config.commands || window.EJS_commands);

        // Setup command callback if EJS_onCommand is defined
        this.notifyCommandCB = null;
        if (typeof config.onCommand === 'function') {
            this.notifyCommandCB = config.onCommand;
        } else if (typeof window.EJS_onCommand === 'function') {
            this.notifyCommandCB = window.EJS_onCommand;
        } else {
            console.warn('EJS_CommandHandler: EJS_onCommand must be a function');
        }
    }

    /**
     * Build command options by merging user commands with defaults
     * @param {Object} userCommands - User-provided command overrides
     * @returns {Object} Merged command map
     * @private
     */
    buildCommandOptions(userCommands) {
        const mergedCommands = this.defaultCommands();
        if (!userCommands || typeof userCommands !== 'object') {
            return mergedCommands;
        }

        // Merge user commands with defaults
        for (const method in userCommands) {
            if (userCommands.hasOwnProperty(method)) {
                const userCommand = userCommands[method];
                if (typeof userCommand === 'function') {
                    // Override the default command with user's implementation
                    mergedCommands[method] = userCommand;
                    if (this.config?.enableLogging) {
                        console.log(`EJS_CommandHandler: Overriding operation "${method}" with custom implementation`);
                    }
                } else if (userCommand === false || userCommand === null) {
                    // Allow disabling operations by setting to false or null
                    delete mergedCommands[method];
                    if (this.config?.enableLogging) {
                        console.log(`EJS_CommandHandler: Disabling operation "${method}"`);
                    }
                } else {
                    console.warn(`EJS_CommandHandler: Invalid command override for "${method}" - must be a function, false, or null`);
                }
            }
        }
        return mergedCommands;
    }

    /**
     * Validates and sets up configuration with defaults
     * @param {Object} config - User configuration
     * @returns {Object} Validated configuration
     * @private
     */
    validateConfig(config) {
        const defaults = {
            fallbackOnError: true,      // Fallback to default on error  
            enableLogging: false,       // Operation logging control
            strictMode: false           // Throw errors instead of fallback
        };
        const validatedConfig = { ...defaults, ...config };
        Object.keys(defaults).forEach(key => {
            if (typeof validatedConfig[key] !== 'boolean') {
                if (config.enableLogging) {
                    console.warn(`EJS_CommandHandler: Invalid config value for ${key}, using default:`, defaults[key]);
                }
                validatedConfig[key] = defaults[key];
            }
        });
        return validatedConfig;
    }

    /**
     * Execute a command
     * @param {string} method - Operation method (e.g., 'input.simulate', 'control.pause')
     * @param {Object} [params={}] - Operation parameters
     * @returns {*} Result from the operation handler
     * @throws {Error} If method is not found and strictMode is enabled
     * @example
     * handler.exec('input.simulate', { player: 0, button: 2, state: 'pressed' });
     * handler.exec('control.pause');
     * handler.exec('state.quickSave', { slot: 1 });
     */
    exec(method, params = {}) {
        if (this.config.enableLogging) {
            console.log('EJS_CommandHandler: Executing operation:', method, params);
        }

        // Validate method exists
        if (!this.commands[method]) {
            const errorMsg = `Unknown operation method: ${method}`;
            if (this.config.strictMode || !this.config.fallbackOnError) {
                throw new Error(errorMsg);
            }
            console.warn('EJS_CommandHandler:', errorMsg, '- operation ignored');
            return null;
        }

        const operation = {
            method,
            params,
            timestamp: Date.now()
        };
        
        let result = null;
        try {
            result = this.commands[method].call(this, operation);
            this.notifyCommand(method, params, result, null);
        } catch (error) {
            const errorMsg = `Error executing operation ${method}: ${error.message}`;
            this.notifyCommand(method, params, null, error);
            if (this.config.strictMode || !this.config.fallbackOnError) {
                throw new Error(errorMsg);
            }
            console.error('EJS_CommandHandler:', errorMsg);
        }

        return result;
    }

    /**
     * Notify command callback
     * @param {string} method - Operation method
     * @param {Object} params - Operation parameters
     * @param {*} result - Operation result (null for pre-execution)
     * @param {string} phase - 'before', 'after', or 'error'
     * @param {Error} [error] - Error if operation failed
     * @private
     */
    notifyCommand(method, params, result, error) {
        if (!this.notifyCommandCB) {
            return;
        }
        const eventData = {
            method,
            params,
            result,
            timestamp: Date.now(),
            error: error ? error.message : null
        };
        try {
            this.notifyCommandCB(eventData);
        } catch (err) {
            console.error('EJS_CommandHandler: Error in EJS_onCommand callback:', err);
        }
    }

    /**
     * Default command implementations
     * Override by setting window.EJS_commands before emulator initialization
     * @returns {Object} Map of method names to handler functions
     * @private
     */
    defaultCommands() {
        return {
            /**
             * Simulate controller input
             * @param {Object} op.params - Parameters
             * @param {number} op.params.player - Player index (0-3)
             * @param {number} op.params.button - Button code
             * @param {string} [op.params.state] - 'pressed', 'released', or 'analog'
             * @param {number} [op.params.value] - Direct value (overrides state)
             */
            'input.simulate': (op) => {
                const { player, button, state, value } = op.params;
                const finalValue = value !== undefined ? value : this.getValueFromState(state, button);
                if (this.emulator.gameManager?.simulateInput) {
                    return this.emulator.gameManager.simulateInput(player, button, finalValue);
                }
            },

            /**
             * Pause emulation
             * @param {Object} op.params - Parameters
             * @param {boolean} [op.params.dontUpdate] - Skip UI update
             */
            'control.pause': (op) => {
                return this.emulator._pause?.(op.params.dontUpdate);
            },

            /**
             * Resume emulation
             * @param {Object} op.params - Parameters
             * @param {boolean} [op.params.dontUpdate] - Skip UI update
             */
            'control.play': (op) => {
                return this.emulator._play?.(op.params.dontUpdate);
            },

            /**
             * Restart current game
             */
            'control.restart': () => {
                if (!this.emulator.gameManager) {
                    console.warn('gameManager not available for restart');
                    return null;
                }
                return this.emulator.gameManager.restart();
            },

            /**
             * Toggle fullscreen
             * @param {Object} op.params - Parameters
             * @param {boolean} [op.params.enabled] - Force state instead of toggle
             */
            'control.fullscreen': (op) => {
                return this.emulator._toggleFullscreen?.(op.params.enabled);
            },

            /**
             * Mute audio
             */
            'control.mute': () => {
                return this.emulator._mute?.();
            },

            /**
             * Unmute audio
             */
            'control.unmute': () => {
                return this.emulator._unmute?.();
            },

            /**
             * Take screenshot
             * @returns {string} Base64 encoded image data
             */
            'control.screenshot': () => {
                return this.emulator.screenshot?.();
            },

            /**
             * Change emulator setting
             * @param {Object} op.params - Parameters
             * @param {string} op.params.setting - Setting name (or 'volume')
             * @param {*} op.params.value - New setting value
             * @param {boolean} [op.params.startup] - Is startup setting
             */
            'settings.change': (op) => {
                const { setting, value, startup } = op.params;
                if (setting === 'volume') {
                    return this.emulator._setVolume?.(value);
                }
                return this.emulator._changeSettingOption?.(setting, value, startup);
            },

            /**
             * Quick save to slot
             * @param {Object} op.params - Parameters
             * @param {number} op.params.slot - Save slot number
             */
            'state.quickSave': (op) => {
                if (!this.emulator.gameManager) {
                    console.warn('gameManager not available for quickSave');
                    return null;
                }
                return this.emulator.gameManager.quickSave(op.params.slot);
            },

            /**
             * Quick load from slot
             * @param {Object} op.params - Parameters
             * @param {number} op.params.slot - Save slot number
             */
            'state.quickLoad': (op) => {
                if (!this.emulator.gameManager) {
                    console.warn('gameManager not available for quickLoad');
                    return null;
                }
                return this.emulator.gameManager.quickLoad(op.params.slot);
            },

            /**
             * Get current save state
             * @returns {ArrayBuffer} Save state data
             */
            'state.save': (op) => {
                return this.emulator.gameManager?.getState();
            },

            /**
             * Load save state
             * @param {Object} op.params - Parameters
             * @param {ArrayBuffer} op.params.state - Save state data
             */
            'state.load': (op) => {
                return this.emulator.gameManager?.loadState(op.params.state);
            },

            /**
             * Toggle fast forward
             * @param {Object} op.params - Parameters
             * @param {boolean} [op.params.enabled] - Force state instead of toggle
             */
            'speed.fastForward': (op) => {
                return this.emulator.gameManager?.toggleFastForward(op.params.enabled);
            },

            /**
             * Toggle slow motion
             * @param {Object} op.params - Parameters
             * @param {boolean} [op.params.enabled] - Force state instead of toggle
             */
            'speed.slowMotion': (op) => {
                return this.emulator.gameManager?.toggleSlowMotion(op.params.enabled);
            },

            /**
             * Toggle rewind
             * @param {Object} op.params - Parameters
             * @param {boolean} [op.params.enabled] - Force state instead of toggle
             */
            'speed.rewind': (op) => {
                return this.emulator.gameManager?.toggleRewind(op.params.enabled);
            },

            /**
             * Set cheat code
             * @param {Object} op.params - Parameters
             * @param {number} op.params.index - Cheat index
             * @param {boolean} op.params.enabled - Enable/disable cheat
             * @param {string} [op.params.code] - Cheat code
             */
            'cheat.set': (op) => {
                return this.emulator.gameManager?.setCheat(op.params.index, op.params.enabled, op.params.code);
            },

            /**
             * Reset all cheats
             */
            'cheat.reset': () => {
                return this.emulator.gameManager?.resetCheat();
            },

            /**
             * Open emulator menu
             */
            'menu.open': () => {
                return this.emulator.menu?.open();
            },

            /**
             * Close emulator menu
             */
            'menu.close': () => {
                return this.emulator.menu?.close();
            },

            /**
             * Reset controls to defaults
             */
            'menu.controlReset': () => {
                this.emulator.controls = JSON.parse(JSON.stringify(this.emulator.defaultControllers));
                this.emulator.setupKeys();
                this.emulator.checkGamepadInputs();
                this.emulator.saveSettings();
            },

            /**
             * Clear all control mappings
             */
            'menu.controlClear': () => {
                this.emulator.controls = { 0: {}, 1: {}, 2: {}, 3: {} };
                this.emulator.setupKeys();
                this.emulator.checkGamepadInputs();
                this.emulator.saveSettings();
            },

            /**
             * Close control configuration popup
             */
            'menu.controlClose': () => {
                if (this.emulator.controlMenu) {
                    this.emulator.controlMenu.style.display = "none";
                }
            },

            /**
             * Set keyboard control mapping
             * @param {Object} op.params - Parameters
             * @param {number} op.params.player - Player index (0-3)
             * @param {string} op.params.button - Button name
             * @param {number} op.params.keyCode - Keyboard key code
             */
            'menu.controlSetKeyboard': (op) => {
                const { player, button, keyCode } = op.params;
                if (!this.emulator.controls[player][button]) {
                    this.emulator.controls[player][button] = {};
                }
                this.emulator.controls[player][button].value = keyCode;
                if (this.emulator.controlPopup) {
                    this.emulator.controlPopup.parentElement.parentElement.setAttribute("hidden", "");
                }
                this.emulator.checkGamepadInputs();
                this.emulator.saveSettings();
            },

            /**
             * Set gamepad control mapping
             * @param {Object} op.params - Parameters
             * @param {number} op.params.player - Player index (0-3)
             * @param {string} op.params.button - Button name
             * @param {string} op.params.label - Gamepad button label
             */
            'menu.controlSetGamepad': (op) => {
                const { player, button, label } = op.params;
                if (!this.emulator.controls[player][button]) {
                    this.emulator.controls[player][button] = {};
                }
                this.emulator.controls[player][button].value2 = label;
                if (this.emulator.controlPopup) {
                    this.emulator.controlPopup.parentElement.parentElement.setAttribute("hidden", "");
                }
                this.emulator.checkGamepadInputs();
                this.emulator.saveSettings();
            }
        };
    }

    /**
     * Convert input state to numeric value
     * @param {string} state - Input state ('pressed', 'released', 'analog')
     * @param {number} button - Button code
     * @returns {number} Numeric value for the input
     * @private
     */
    getValueFromState(state, button) {
        switch (state) {
            case 'released':
                return 0;
            case 'pressed':
                // Analog stick buttons (16-23) use different values
                const special = [16, 17, 18, 19, 20, 21, 22, 23];
                return special.includes(button) ? 0x7fff : 1;
            case 'analog':
                return 0x7fff;
            default:
                return 0;
        }
    }
}

/**
 * Execute auto-start operations if configured
 * @param {EJS_CommandHandler} handler - Handler instance
 * @private
 */
function EJS_executeInitCommands(handler) {
    const autoStartOps = window.EJS_initCommands;
    if (!autoStartOps || !Array.isArray(autoStartOps)) {
        return;
    }
    autoStartOps.forEach(op => {
        if (op && op.method) {
            try {
                handler.exec(op.method, op.params || {});
            } catch (error) {
                console.error('EJS_CommandHandler: Auto-start operation failed:', error);
            }
        }
    });
}

window.EJS_CommandHandler = EJS_CommandHandler;
window.EJS_executeInitCommands = EJS_executeInitCommands;
