(function (window) {
'use strict';

var exports = {};
Object.defineProperty(exports, '__esModule', { value: true });

/*! *****************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
/* global Reflect, Promise */

var extendStatics = function(d, b) {
    extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
    return extendStatics(d, b);
};

function __extends(d, b) {
    extendStatics(d, b);
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
}

var __assign = function() {
    __assign = Object.assign || function __assign(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};

var EventEmitter = /** @class */ (function () {
    function EventEmitter() {
        this.listeners = {};
    }
    EventEmitter.prototype.on = function (eventType, cb) {
        var _a;
        var callbacks = (_a = this.listeners[eventType]) !== null && _a !== void 0 ? _a : [];
        this.listeners[eventType] = callbacks.concat([cb]);
    };
    EventEmitter.prototype.triggerEvent = function (eventType, event) {
        var _a;
        var callbacks = (_a = this.listeners[eventType]) !== null && _a !== void 0 ? _a : [];
        callbacks.forEach(function (callback) { return callback(event); });
    };
    return EventEmitter;
}());

var NotyfNotification = /** @class */ (function (_super) {
    __extends(NotyfNotification, _super);
    function NotyfNotification(options) {
        var _this = _super.call(this) || this;
        _this.options = options;
        return _this;
    }
    return NotyfNotification;
}(EventEmitter));
(function (NotyfArrayEvent) {
    NotyfArrayEvent[NotyfArrayEvent["Add"] = 0] = "Add";
    NotyfArrayEvent[NotyfArrayEvent["Remove"] = 1] = "Remove";
})(exports.NotyfArrayEvent || (exports.NotyfArrayEvent = {}));
var NotyfArray = /** @class */ (function () {
    function NotyfArray() {
        this.notifications = [];
    }
    NotyfArray.prototype.push = function (elem) {
        this.notifications.push(elem);
        this.updateFn(elem, exports.NotyfArrayEvent.Add, this.notifications);
    };
    NotyfArray.prototype.splice = function (index, num) {
        var elem = this.notifications.splice(index, num)[0];
        this.updateFn(elem, exports.NotyfArrayEvent.Remove, this.notifications);
        return elem;
    };
    NotyfArray.prototype.indexOf = function (elem) {
        return this.notifications.indexOf(elem);
    };
    NotyfArray.prototype.onUpdate = function (fn) {
        this.updateFn = fn;
    };
    return NotyfArray;
}());

(function (NotyfEvent) {
    NotyfEvent["Dismiss"] = "dismiss";
    NotyfEvent["Click"] = "click";
    NotyfEvent["MouseOver"] = "mouseover";
    NotyfEvent["MouseLeave"] = "mouseleave";
})(exports.NotyfEvent || (exports.NotyfEvent = {}));
var DEFAULT_OPTIONS = {
    types: [
        {
            type: 'success',
            className: 'notyf__toast--success',
            backgroundColor: '#3dc763',
            icon: {
                className: 'notyf__icon--success',
                tagName: 'i',
            },
        },
        {
            type: 'error',
            className: 'notyf__toast--error',
            backgroundColor: '#ed3d3d',
            icon: {
                className: 'notyf__icon--error',
                tagName: 'i',
            },
        },
    ],
    duration: 2000,
    ripple: true,
    position: {
        x: 'right',
        y: 'bottom',
    },
    dismissible: false,
};

var NotyfView = /** @class */ (function () {
    function NotyfView() {
        this.notifications = [];
        this.events = {};
        this.X_POSITION_FLEX_MAP = {
            left: 'flex-start',
            center: 'center',
            right: 'flex-end',
        };
        this.Y_POSITION_FLEX_MAP = {
            top: 'flex-start',
            center: 'center',
            bottom: 'flex-end',
        };
        // Creates the main notifications container
        var docFrag = document.createDocumentFragment();
        var notyfContainer = this._createHTMLElement({ tagName: 'div', className: 'notyf' });
        docFrag.appendChild(notyfContainer);
        document.body.appendChild(docFrag);
        this.container = notyfContainer;
        // Identifies the main animation end event
        this.animationEndEventName = this._getAnimationEndEventName();
        this._createA11yContainer();
    }
    NotyfView.prototype.on = function (event, cb) {
        var _a;
        this.events = __assign(__assign({}, this.events), (_a = {}, _a[event] = cb, _a));
    };
    NotyfView.prototype.update = function (notification, type) {
        if (type === exports.NotyfArrayEvent.Add) {
            this.addNotification(notification);
        }
        else if (type === exports.NotyfArrayEvent.Remove) {
            this.removeNotification(notification);
        }
    };
    /**
    * Returns the DOM element associated with a notification.
    */
    NotyfView.prototype.getNotificationElement = function (notification) {
        // NotyfView typically keeps a map of rendered notifications (e.g. this._notifications)
        // If not, we can find it by data attributes that Notyf sets on creation.
        var id = notification.id || notification._id;
        if (!id) {
            // fallback – search for matching message text (less ideal)
            return this.container.querySelector('.notyf__toast:last-child');
        }
        // Example: if you set a data attribute on each toast when rendering:
        return this.container.querySelector(".notyf__toast[data-notyf-id=\"" + id + "\"]");
    };
    NotyfView.prototype.removeNotification = function (notification) {
        var _this = this;
        var renderedNotification = this._popRenderedNotification(notification);
        var node;
        if (!renderedNotification) {
            return;
        }
        node = renderedNotification.node;
        node.classList.add('notyf__toast--disappear');
        var handleEvent;
        node.addEventListener(this.animationEndEventName, (handleEvent = function (event) {
            if (event.target === node) {
                node.removeEventListener(_this.animationEndEventName, handleEvent);
                _this.container.removeChild(node);
            }
        }));
    };
    NotyfView.prototype.addNotification = function (notification) {
        var node = this._renderNotification(notification);
        this.notifications.push({ notification: notification, node: node });
        // For a11y purposes, we still want to announce that there's a notification in the screen
        // even if it comes with no message.
        this._announce(notification.options.message || 'Notification');
    };
    NotyfView.prototype.startProgressLine = function (notification, durationMs) {
        var toastEl = this.getNotificationElement(notification);
        if (!toastEl)
            return;
        var lineEl = toastEl.querySelector('.notyf-progress');
        if (!lineEl) {
            lineEl = document.createElement('span');
            lineEl.className = 'notyf-progress';
            toastEl.appendChild(lineEl);
        }
        // Set / reset duration and start running
        lineEl.style.animationDuration = durationMs + "ms";
        // restart animation in case this element was reused
        // force reflow to restart keyframes
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        lineEl.offsetWidth;
        lineEl.style.animationPlayState = 'running';
        // Optional: if you want to auto-remove the bar on CSS end (backup to timer)
        var onEnd = function () {
            lineEl === null || lineEl === void 0 ? void 0 : lineEl.removeEventListener('animationend', onEnd);
            lineEl === null || lineEl === void 0 ? void 0 : lineEl.remove();
        };
        lineEl.addEventListener('animationend', onEnd);
    };
    NotyfView.prototype.pauseProgressLine = function (notification) {
        var toastEl = this.getNotificationElement(notification);
        var lineEl = toastEl === null || toastEl === void 0 ? void 0 : toastEl.querySelector('.notyf-progress');
        if (lineEl)
            lineEl.style.animationPlayState = 'paused';
    };
    NotyfView.prototype.resumeProgressLine = function (notification) {
        var toastEl = this.getNotificationElement(notification);
        var lineEl = toastEl === null || toastEl === void 0 ? void 0 : toastEl.querySelector('.notyf-progress');
        if (lineEl)
            lineEl.style.animationPlayState = 'running';
    };
    NotyfView.prototype.finishProgressLine = function (notification) {
        var toastEl = this.getNotificationElement(notification);
        var lineEl = toastEl === null || toastEl === void 0 ? void 0 : toastEl.querySelector('.notyf-progress');
        if (lineEl) {
            // snap to 0 and fade, then remove
            lineEl.style.transition = 'transform 120ms linear, opacity 120ms linear';
            lineEl.style.transform = 'scaleX(0)';
            lineEl.style.opacity = '0';
            // remove after the snap transition
            setTimeout(function () { return lineEl.remove(); }, 140);
        }
    };
    NotyfView.prototype._renderNotification = function (notification) {
        var _a;
        var card = this._buildNotificationCard(notification);
        var className = notification.options.className;
        if (className) {
            (_a = card.classList).add.apply(_a, className.split(' '));
        }
        this.container.appendChild(card);
        return card;
    };
    NotyfView.prototype._popRenderedNotification = function (notification) {
        var idx = -1;
        for (var i = 0; i < this.notifications.length && idx < 0; i++) {
            if (this.notifications[i].notification === notification) {
                idx = i;
            }
        }
        if (idx !== -1) {
            return this.notifications.splice(idx, 1)[0];
        }
        return;
    };
    NotyfView.prototype.getXPosition = function (options) {
        var _a;
        return ((_a = options === null || options === void 0 ? void 0 : options.position) === null || _a === void 0 ? void 0 : _a.x) || 'right';
    };
    NotyfView.prototype.getYPosition = function (options) {
        var _a;
        return ((_a = options === null || options === void 0 ? void 0 : options.position) === null || _a === void 0 ? void 0 : _a.y) || 'bottom';
    };
    NotyfView.prototype.adjustContainerAlignment = function (options) {
        var align = this.X_POSITION_FLEX_MAP[this.getXPosition(options)];
        var justify = this.Y_POSITION_FLEX_MAP[this.getYPosition(options)];
        var style = this.container.style;
        style.setProperty('justify-content', justify);
        style.setProperty('align-items', align);
    };
    NotyfView.prototype._buildNotificationCard = function (notification) {
        var _this = this;
        var options = notification.options;
        var iconOpts = options.icon;
        // Adjust container according to position (e.g. top-left, bottom-center, etc)
        this.adjustContainerAlignment(options);
        // Create elements
        var notificationElem = this._createHTMLElement({ tagName: 'div', className: 'notyf__toast' });
        var ripple = this._createHTMLElement({ tagName: 'div', className: 'notyf__ripple' });
        var wrapper = this._createHTMLElement({ tagName: 'div', className: 'notyf__wrapper' });
        var message = this._createHTMLElement({ tagName: 'div', className: 'notyf__message' });
        message.innerHTML = options.message || '';
        var mainColor = options.background || options.backgroundColor;
        // Build the icon and append it to the card
        if (iconOpts) {
            var iconContainer = this._createHTMLElement({ tagName: 'div', className: 'notyf__icon' });
            if (typeof iconOpts === 'string' || iconOpts instanceof String)
                iconContainer.innerHTML = new String(iconOpts).valueOf();
            if (typeof iconOpts === 'object') {
                var _a = iconOpts.tagName, tagName = _a === void 0 ? 'i' : _a, className_1 = iconOpts.className, text = iconOpts.text, _b = iconOpts.color, color = _b === void 0 ? mainColor : _b;
                var iconElement = this._createHTMLElement({ tagName: tagName, className: className_1, text: text });
                if (color)
                    iconElement.style.color = color;
                iconContainer.appendChild(iconElement);
            }
            wrapper.appendChild(iconContainer);
        }
        wrapper.appendChild(message);
        notificationElem.appendChild(wrapper);
        // Add ripple if applicable, else just paint the full toast
        if (mainColor) {
            if (options.ripple) {
                ripple.style.background = mainColor;
                notificationElem.appendChild(ripple);
            }
            else {
                notificationElem.style.background = mainColor;
            }
        }
        // Add dismiss button
        if (options.dismissible) {
            var dismissWrapper = this._createHTMLElement({ tagName: 'div', className: 'notyf__dismiss' });
            var dismissButton = this._createHTMLElement({
                tagName: 'button',
                className: 'notyf__dismiss-btn',
            });
            dismissWrapper.appendChild(dismissButton);
            wrapper.appendChild(dismissWrapper);
            notificationElem.classList.add("notyf__toast--dismissible");
            dismissButton.addEventListener('click', function (event) {
                var _a, _b;
                (_b = (_a = _this.events)[exports.NotyfEvent.Dismiss]) === null || _b === void 0 ? void 0 : _b.call(_a, { target: notification, event: event });
                event.stopPropagation();
            });
        }
        notificationElem.addEventListener('click', function (event) { var _a, _b; return (_b = (_a = _this.events)[exports.NotyfEvent.Click]) === null || _b === void 0 ? void 0 : _b.call(_a, { target: notification, event: event }); });
        notificationElem.addEventListener('mouseover', function (event) {
            return notification.triggerEvent(exports.NotyfEvent.MouseOver, { target: notification, event: event });
        });
        notificationElem.addEventListener('mouseleave', function (event) {
            return notification.triggerEvent(exports.NotyfEvent.MouseLeave, { target: notification, event: event });
        });
        // Adjust margins depending on whether its an upper or lower notification
        var className = this.getYPosition(options) === 'top' ? 'upper' : 'lower';
        notificationElem.classList.add("notyf__toast--" + className);
        return notificationElem;
    };
    NotyfView.prototype._createHTMLElement = function (_a) {
        var tagName = _a.tagName, className = _a.className, text = _a.text;
        var elem = document.createElement(tagName);
        if (className) {
            elem.className = className;
        }
        elem.textContent = text || null;
        return elem;
    };
    /**
     * Creates an invisible container which will announce the notyfs to
     * screen readers
     */
    NotyfView.prototype._createA11yContainer = function () {
        var a11yContainer = this._createHTMLElement({ tagName: 'div', className: 'notyf-announcer' });
        a11yContainer.setAttribute('aria-atomic', 'true');
        a11yContainer.setAttribute('aria-live', 'polite');
        // Set the a11y container to be visible hidden. Can't use display: none as
        // screen readers won't read it.
        a11yContainer.style.border = '0';
        a11yContainer.style.clip = 'rect(0 0 0 0)';
        a11yContainer.style.height = '1px';
        a11yContainer.style.margin = '-1px';
        a11yContainer.style.overflow = 'hidden';
        a11yContainer.style.padding = '0';
        a11yContainer.style.position = 'absolute';
        a11yContainer.style.width = '1px';
        a11yContainer.style.outline = '0';
        document.body.appendChild(a11yContainer);
        this.a11yContainer = a11yContainer;
    };
    /**
     * Announces a message to screenreaders.
     */
    NotyfView.prototype._announce = function (message) {
        var _this = this;
        this.a11yContainer.textContent = '';
        // This 100ms timeout is necessary for some browser + screen-reader combinations:
        // - Both JAWS and NVDA over IE11 will not announce anything without a non-zero timeout.
        // - With Chrome and IE11 with NVDA or JAWS, a repeated (identical) message won't be read a
        //   second time without clearing and then using a non-zero delay.
        // (using JAWS 17 at time of this writing).
        // https://github.com/angular/material2/blob/master/src/cdk/a11y/live-announcer/live-announcer.ts
        setTimeout(function () {
            _this.a11yContainer.textContent = message;
        }, 100);
    };
    /**
     * Determine which animationend event is supported
     */
    NotyfView.prototype._getAnimationEndEventName = function () {
        var el = document.createElement('_fake');
        var transitions = {
            MozTransition: 'animationend',
            OTransition: 'oAnimationEnd',
            WebkitTransition: 'webkitAnimationEnd',
            transition: 'animationend',
        };
        var t;
        for (t in transitions) {
            if (el.style[t] !== undefined) {
                return transitions[t];
            }
        }
        // No supported animation end event. Using "animationend" as a fallback
        return 'animationend';
    };
    return NotyfView;
}());

var Timer = /** @class */ (function (_super) {
    __extends(Timer, _super);
    function Timer(duration) {
        var _this = _super.call(this) || this;
        _this.duration = duration;
        _this.startTime = Date.now();
        _this.lastTime = Date.now();
        _this.timer = setTimeout(function () {
            _this.triggerEvent('finished', undefined);
            _this.lastTime = Date.now();
        }, duration);
        return _this;
    }
    Object.defineProperty(Timer.prototype, "leftTime", {
        get: function () {
            return this.duration - (this.lastTime - this.startTime);
        },
        enumerable: false,
        configurable: true
    });
    Timer.prototype.pause = function () {
        clearTimeout(this.timer);
        this.lastTime = Date.now();
        this.triggerEvent('pause', undefined);
    };
    Timer.prototype.resume = function () {
        var _this = this;
        clearTimeout(this.timer);
        this.timer = setTimeout(function () {
            _this.triggerEvent('finished', undefined);
            _this.lastTime = Date.now();
        }, this.leftTime);
        this.triggerEvent('resume', undefined);
    };
    return Timer;
}(EventEmitter));

/**
 * Notyf Confirm Dialog
 * A SweetAlert2-style confirmation popup integrated into Notyf.
 */
var DEFAULT_BUTTONS = [
    { text: 'Yes', background: '#3dc763', color: '#fff', value: true },
    { text: 'No', background: '#ed3d3d', color: '#fff', value: false },
];
var NotyfConfirm = /** @class */ (function () {
    function NotyfConfirm() {
        this.overlay = null;
        this.dialog = null;
        this._resolve = null;
        this._onKey = null;
    }
    /**
     * Opens a confirmation dialog.
     * Returns a Promise that resolves with the `value` of the clicked button,
     * or `null` when the backdrop is clicked (if `closeOnBackdrop` is true).
     */
    NotyfConfirm.prototype.fire = function (opts) {
        var _this = this;
        // Remove any stale ESC keydown listener from a previous fire()
        if (_this._onKey) { document.removeEventListener('keydown', _this._onKey); _this._onKey = null; }
        // Resolve any pending promise from a previous fire() that never settled
        if (_this._resolve) { _this._resolve(null); _this._resolve = null; }
        // Force-remove any stale overlays from DOM
        document.querySelectorAll('.notyf-confirm__overlay').forEach(function(el) { el.remove(); });
        _this.overlay = null;
        _this.dialog = null;
        return new Promise(function (resolve) {
            _this._resolve = resolve;
            var title = opts.title, message = opts.message, _a = opts.background, background = _a === void 0 ? '#2f2f2f' : _a, _b = opts.color, color = _b === void 0 ? '#ffffff' : _b, icon = opts.icon, _c = opts.buttons, buttons = _c === void 0 ? DEFAULT_BUTTONS : _c, _d = opts.closeOnBackdrop, closeOnBackdrop = _d === void 0 ? true : _d, onOpen = opts.onOpen, input = opts.input;
            // ── overlay ─────────────────────────────────────────────────────────
            var overlay = document.createElement('div');
            overlay.className = 'notyf-confirm__overlay';
            _this.overlay = overlay;
            // ── dialog card ─────────────────────────────────────────────────────
            var dialog = document.createElement('div');
            dialog.className = 'notyf-confirm__dialog';
            dialog.style.background = background;
            dialog.style.color = color;
            dialog.setAttribute('role', 'alertdialog');
            dialog.setAttribute('aria-modal', 'true');
            _this.dialog = dialog;
            // optional icon
            if (icon) {
                var iconEl = document.createElement('div');
                iconEl.className = 'notyf-confirm__icon';
                iconEl.innerHTML = icon;
                dialog.appendChild(iconEl);
            }
            // title
            if (title) {
                var titleEl = document.createElement('div');
                titleEl.className = 'notyf-confirm__title';
                titleEl.innerHTML = title;
                dialog.appendChild(titleEl);
            }
            // message
            var msgEl = document.createElement('div');
            msgEl.className = 'notyf-confirm__message';
            if (message) {
                msgEl.innerHTML = message;
            }
            dialog.appendChild(msgEl);
            // ── input ────────────────────────────────────────────────────────────
            var inputEl = null;
            if (input) {
                var inputWrap = document.createElement('div');
                inputWrap.className = 'notyf-confirm__input-wrap';
                if (input.label) {
                    var lbl = document.createElement('label');
                    lbl.className = 'notyf-confirm__input-label';
                    lbl.textContent = input.label;
                    inputWrap.appendChild(lbl);
                }
                if (input.type === 'select') {
                    var sel = document.createElement('select');
                    sel.className = 'notyf-confirm__input notyf-confirm__input--select';
                    if (input.placeholder) {
                        var ph = document.createElement('option');
                        ph.value = '';
                        ph.textContent = input.placeholder;
                        ph.disabled = true;
                        ph.selected = !input.value;
                        sel.appendChild(ph);
                    }
                    if (input.options) {
                        Object.entries(input.options).forEach(function(_a) {
                            var val = _a[0], label = _a[1];
                            var opt = document.createElement('option');
                            opt.value = val;
                            opt.textContent = label;
                            if (input.value && input.value === val) opt.selected = true;
                            sel.appendChild(opt);
                        });
                    }
                    inputEl = sel;
                } else {
                    var txt = document.createElement('input');
                    txt.type = 'text';
                    txt.className = 'notyf-confirm__input notyf-confirm__input--text';
                    txt.value = input.value || '';
                    if (input.placeholder) txt.placeholder = input.placeholder;
                    inputEl = txt;
                }
                inputWrap.appendChild(inputEl);
                dialog.appendChild(inputWrap);
            }
            // buttons row
            var btnRow = document.createElement('div');
            btnRow.className = 'notyf-confirm__buttons';
            var cleanup = function (value) {
                if (_this._onKey) { document.removeEventListener('keydown', _this._onKey); _this._onKey = null; }
                _this._resolve = null;
                _this._remove();
                resolve(value);
            };
            buttons.forEach(function (btn) {
                var el = document.createElement('button');
                el.type = 'button';
                el.className = 'notyf-confirm__btn' + (btn.className ? " " + btn.className : '');
                el.textContent = btn.text;
                if (btn.background) el.style.background = btn.background;
                if (btn.color)      el.style.color = btn.color;
                el.addEventListener('click', function () {
                    // confirm button (value===true) + input present → resolve with input value
                    if (btn.value === true && inputEl) {
                        cleanup(inputEl.value);
                    } else {
                        var val = typeof btn.value === 'function' ? btn.value() : (btn.value !== null && btn.value !== void 0 ? btn.value : btn.text);
                        cleanup(val);
                    }
                });
                btnRow.appendChild(el);
            });
            dialog.appendChild(btnRow);
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);
            // call onOpen now that the dialog is live in the DOM
            if (typeof onOpen === 'function') {
                onOpen(msgEl);
            }
            // trigger CSS enter animation on next frame
            requestAnimationFrame(function () {
                overlay.classList.add('notyf-confirm__overlay--visible');
                dialog.classList.add('notyf-confirm__dialog--visible');
                if (inputEl) {
                    inputEl.focus();
                    if (inputEl.tagName === 'INPUT') inputEl.select();
                }
            });
            // backdrop click
            if (closeOnBackdrop) {
                overlay.addEventListener('click', function (e) {
                    if (e.target === overlay) cleanup(null);
                });
            }
            // ESC key
            _this._onKey = function (e) {
                if (e.key === 'Escape') {
                    cleanup(null);
                }
            };
            document.addEventListener('keydown', _this._onKey);
            // Enter submits text input
            if (inputEl && input && input.type === 'text') {
                inputEl.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter') cleanup(inputEl.value);
                });
            }
        });
    };
    NotyfConfirm.prototype._remove = function () {
        var _a;
        if (this.overlay) {
            this.overlay.classList.remove('notyf-confirm__overlay--visible');
            (_a = this.dialog) === null || _a === void 0 ? void 0 : _a.classList.remove('notyf-confirm__dialog--visible');
            var overlay_1 = this.overlay;
            var removed_1 = false;
            var doRemove = function () {
                if (!removed_1) {
                    removed_1 = true;
                    if (overlay_1.parentNode) overlay_1.parentNode.removeChild(overlay_1);
                }
            };
            overlay_1.addEventListener('transitionend', doRemove, { once: true });
            setTimeout(doRemove, 400);
            this.overlay = null;
            this.dialog = null;
        }
    };
    return NotyfConfirm;
}());

/**
 * Main controller class. Defines the main Notyf API.
 */
var Notyf = /** @class */ (function () {
    function Notyf(opts) {
        var _this = this;
        this.dismiss = this._removeNotification;
        this.notifications = new NotyfArray();
        this.view = new NotyfView();
        this._confirm = new NotyfConfirm();
        var types = this.registerTypes(opts);
        this.options = __assign(__assign({}, DEFAULT_OPTIONS), opts);
        this.options.types = types;
        this.notifications.onUpdate(function (elem, type) { return _this.view.update(elem, type); });
        this.view.on(exports.NotyfEvent.Dismiss, function (_a) {
            var target = _a.target, event = _a.event;
            _this._removeNotification(target);
            target.triggerEvent(exports.NotyfEvent.Dismiss, { target: target, event: event });
        });
        this.view.on(exports.NotyfEvent.Click, function (_a) {
            var target = _a.target, event = _a.event;
            return target.triggerEvent(exports.NotyfEvent.Click, { target: target, event: event });
        });
    }
    Notyf.prototype.error = function (payload) {
        var options = this.normalizeOptions('error', payload);
        return this.open(options);
    };
    Notyf.prototype.success = function (payload) {
        var options = this.normalizeOptions('success', payload);
        return this.open(options);
    };
    Notyf.prototype.open = function (options) {
        var defaultOpts = this.options.types.find(function (_a) {
            var type = _a.type;
            return type === options.type;
        }) || {};
        var config = __assign(__assign({}, defaultOpts), options);
        this.assignProps(['ripple', 'position', 'dismissible'], config);
        var notification = new NotyfNotification(config);
        this._pushNotification(notification);
        return notification;
    };
    /**
     * Opens a SweetAlert2-style confirmation dialog.
     *
     * @example
     * const result = await notyf.confirm({
     *   title: 'Are you sure?',
     *   message: 'This action cannot be undone.',
     *   background: '#1e1e2e',
     *   buttons: [
     *     { text: 'Yes, delete', background: '#ed3d3d', color: '#fff', value: true },
     *     { text: 'Cancel',      background: '#555',    color: '#fff', value: false },
     *   ],
     * });
     * if (result === true) { ... }
     */
    Notyf.prototype.confirm = function (opts) {
        // Delegate to the shared global instance to avoid multiple instances conflicting
        var instance = (typeof window !== 'undefined' && window.notyfConfirm) ? window.notyfConfirm : this._confirm;
        return instance.fire(opts);
    };
    Notyf.prototype.dismissAll = function () {
        while (this.notifications.splice(0, 1))
            ;
    };
    /**
     * Assigns properties to a config object based on two rules:
     * 1. If the config object already sets that prop, leave it as so
     * 2. Otherwise, use the default prop from the global options
     *
     * It's intended to build the final config object to open a notification. e.g. if
     * 'dismissible' is not set, then use the value from the global config.
     *
     * @param props - properties to be assigned to the config object
     * @param config - object whose properties need to be set
     */
    Notyf.prototype.assignProps = function (props, config) {
        var _this = this;
        props.forEach(function (prop) {
            // intentional double equality to check for both null and undefined
            config[prop] = config[prop] == null ? _this.options[prop] : config[prop];
        });
    };
    Notyf.prototype._pushNotification = function (notification) {
        var _this = this;
        this.notifications.push(notification);
        var duration = notification.options.duration !== undefined
            ? notification.options.duration
            : this.options.duration;
        if (!duration)
            return;
        var timer = new Timer(duration);
        // Start the shrinking line in the view, same duration as the timer
        this.view.startProgressLine(notification, duration);
        // Pause on hover -> pause timer AND pause the line (do not hide it)
        notification.on(exports.NotyfEvent.MouseOver, function () {
            timer.pause();
            _this.view.pauseProgressLine(notification);
        });
        // Resume on mouse leave -> resume timer AND the line
        notification.on(exports.NotyfEvent.MouseLeave, function () {
            timer.resume();
            _this.view.resumeProgressLine(notification);
        });
        // When the timer finishes, finish line + remove toast
        timer.on('finished', function () {
            _this.view.finishProgressLine(notification); // optional: force to 0 / cleanup
            _this._removeNotification(notification);
        });
    };
    Notyf.prototype._removeNotification = function (notification) {
        var index = this.notifications.indexOf(notification);
        if (index !== -1) {
            this.notifications.splice(index, 1);
        }
    };
    Notyf.prototype.normalizeOptions = function (type, payload) {
        var options = { type: type };
        if (typeof payload === 'string') {
            options.message = payload;
        }
        else if (typeof payload === 'object') {
            options = __assign(__assign({}, options), payload);
        }
        return options;
    };
    Notyf.prototype.registerTypes = function (opts) {
        var incomingTypes = ((opts && opts.types) || []).slice();
        var finalDefaultTypes = DEFAULT_OPTIONS.types.map(function (defaultType) {
            // find if there's a default type within the user input's types, if so, it means the user
            // wants to change some of the default settings
            var userTypeIdx = -1;
            incomingTypes.forEach(function (t, idx) {
                if (t.type === defaultType.type)
                    userTypeIdx = idx;
            });
            var userType = userTypeIdx !== -1 ? incomingTypes.splice(userTypeIdx, 1)[0] : {};
            return __assign(__assign({}, defaultType), userType);
        });
        return finalDefaultTypes.concat(incomingTypes);
    };
    return Notyf;
}());

exports.DEFAULT_OPTIONS = DEFAULT_OPTIONS;
exports.Notyf = Notyf;
exports.NotyfArray = NotyfArray;
exports.NotyfConfirm = NotyfConfirm;
exports.NotyfNotification = NotyfNotification;
exports.NotyfView = NotyfView;

// Expose to global scope
window.Notyf = Notyf;
window.NotyfConfirm = NotyfConfirm;

}(window));