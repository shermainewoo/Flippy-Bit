/**
 * Inside this file you will use the classes and functions from rx.js
 * to add visuals to the svg element in index.html, animate them, and make them interactive.
 *
 * Study and complete the tasks in observable exercises first to get ideas.
 *
 * Course Notes showing Asteroids in FRP: https://tgdwyer.github.io/asteroids/
 *
 * You will be marked on your functional programming style
 * as well as the functionality that you implement.
 *
 * Document your code!
 *
 * Generative AI was used throughout this assignment, for debugging and in explaining concepts
 * more details regarding use, as well as extra controls can be found in README.md
 */

import "./style.css";

import {
    Observable,
    filter,
    fromEvent,
    interval,
    map,
    merge,
    scan,
    switchMap,
    take,
} from "rxjs";

/** Constants */

const Viewport = {
    CANVAS_WIDTH: 600,
    CANVAS_HEIGHT: 400,
} as const;

const Target = {
    WIDTH: 64,
    HEIGHT: 36,
} as const;

const Constants = {
    DIGIT_COUNT: 8,
    TICK_RATE_MS: 500, // Might need to change this!
} as const;

const FallConstants = {
    //MIN_SPAWN and MAX_SPAWN are both used by randomDelay to determine spawn rate
    MIN_SPAWN: 1000,
    MAX_SPAWN: 3000,
    FALL_RATE: 7, //moves 7 pixels each tick
    CHECK_LINE: Viewport.CANVAS_HEIGHT - 60,
} as const;

//Maps keyboard controls from 1-8 to corresponding item index
//Ensures that only keyboard clicks from 1-8 are considered
//Readonly used to prevent mutation
const keyToIndex: Readonly<Record<string, number>> = {
    "1": 0,
    "2": 1,
    "3": 2,
    "4": 3,
    "5": 4,
    "6": 5,
    "7": 6,
    "8": 7,
};

/**
 * A random number generator used for positioning and target numbers,
 * uses a (LCG) algorithm referenced from previous applied activities.
 *
 * next() returns a new RNG instance, rather than mutating the state,
 * ensuring that random number generation is pure
 *
 */
class RNG {
    private static readonly m = 0x80000000; // modulus (2^31)
    private static readonly a = 1103515245; //multiplier
    private static readonly c = 12345; //increment

    constructor(public readonly seed: number) {}

    /**
     * advances the generator by one step
     * @returns a new RNG instance with next seed in the sequence
     */
    next(): RNG {
        return new RNG((RNG.a * this.seed + RNG.c) % RNG.m);
    }

    /**
     * converts the current seed into a float in the range 0 and 1
     * @returns a random float between 0 and 1
     */
    float(): number {
        return this.seed / RNG.m;
    }
}

//converts a milisecond duration into a whole number of ticks
const msToTicks = (ms: number): number =>
    Math.round(ms / Constants.TICK_RATE_MS);

/**
 * generates a random delay for the tick spawn rate
 * calculated using minTick and maxTick so its within an acceptable range
 * @param rng current rng state
 * @returns the tickDelay, alongside advanced rng
 */
const randomDelay = (rng: RNG): { tickDelay: number; rng: RNG } => {
    const minTick = msToTicks(FallConstants.MIN_SPAWN);
    const maxTick = msToTicks(FallConstants.MAX_SPAWN);
    const range = maxTick - minTick;
    return {
        tickDelay: minTick + Math.floor(rng.float() * range),
        rng: rng.next(),
    };
};

/**
 * generates a random 2-digit hex value
 * Floor + scale by 256 guarantess that the result always will be within the 00 to FF range
 * @param rng current rng state
 * @returns a random 2-digit hex value, alongside advanced rng
 */
const randomHex = (rng: RNG): { value: string; rng: RNG } => {
    const decimal = Math.floor(rng.float() * 256);
    return {
        value: decimal.toString(16).toUpperCase().padStart(2, "0"),
        rng: rng.next(),
    };
};

/**
 * generates a random horizontal spawn position for target on x axis
 * margin ensures that it spawns within the range of the canvas
 * @param rng current rng state
 * @returns a random x position and the advanced rng
 */
const randomPosition = (rng: RNG): { x: number; rng: RNG } => {
    const margin = Target.WIDTH / 2;
    const range = Viewport.CANVAS_WIDTH - margin * 2;
    return {
        x: margin + Math.floor(rng.float() * range),
        rng: rng.next(),
    };
};

/**
 * Converts the 8 binary digit into a hex string
 * @param digits the current array of values toggled
 * @returns a hex string from the 8 binary digit
 */
const digitstoHex = (digits: readonly (0 | 1)[]): string =>
    digits
        .reduce<number>((acc, bit) => acc * 2 + bit, 0)
        .toString(16)
        .toUpperCase()
        .padStart(2, "0");

// State processing
type FallingTarget = Readonly<{
    id: number;
    value: string;
    yPosition: number;
    xPosition: number;
}>;

type State = Readonly<{
    gameEnd: boolean;
    digits: readonly (0 | 1)[]; //Tracks value of each digit
    targets: readonly FallingTarget[];
    playerHex: string;
    score: number;
    rng: RNG;
    spawnTick: number;
    spawnNext: number;
}>;

//initialState is a function so that a new RNG seed is created
//for the beginning of each new game alongside every restart
const initialState = (): State => {
    const seed = Date.now() % 0x80000000 || 1;
    const rng = new RNG(seed).next().next();
    return {
        gameEnd: false,
        //fills each digit with a 0
        digits: Array(Constants.DIGIT_COUNT).fill(0),
        playerHex: digitstoHex(Array(Constants.DIGIT_COUNT).fill(0)),
        targets: [],
        score: 0,
        //Instance of non-deterministic value to seed RNG
        rng,
        spawnTick: 1,
        spawnNext: 0,
    };
};

/**
 * returns a new digit array with the digit at index flipped
 * iterates over each element in the array, and builds a new array
 * without mutating the original array
 */
const digitToggle = (
    digits: readonly (0 | 1)[],
    index: number,
): readonly (0 | 1)[] =>
    digits.map((val, idx) => (idx === index ? ((1 - val) as 0 | 1) : val));
//if val is 0, 1-0 = 1, if val is 1, 1-1 = 0

/**
 * Moves each target down by FALL_RATE
 * @param targets each target being moved
 * @returns updated target position
 */
const advanceTargets = (
    targets: readonly FallingTarget[],
): readonly FallingTarget[] =>
    targets.map(t => ({
        ...t,
        yPosition: t.yPosition + FallConstants.FALL_RATE,
    }));

//DigitClick is a constructor for when a digit is clicked
class DigitClick {
    constructor(public readonly index: number) {}
}
//represents each accurance of a tick happening
type TickAction = Readonly<{ kind: "TICK"; tickCount: number }>;

//action type for restart
type RestartAction = Readonly<{ kind: "RESTART" }>;

//represents a kind of action that is used in reduceState
type Action = DigitClick | TickAction | RestartAction;

/**
 * spawns a new target with a random value, position, and delay
 * @param targets the current target
 * @param tickCount the current tick number
 * @param spawnTick the tick number at which the next target is spawned
 * @param rng the current state of the random number generator
 * @param spawnNext the id for the next target spawned
 * @returns the updated target, the next spawnTick, the advanced rng, and next spawn id
 */
const spawnNew = (
    targets: readonly FallingTarget[],
    tickCount: number,
    spawnTick: number,
    rng: RNG,
    spawnNext: number,
): {
    targets: readonly FallingTarget[];
    spawnTick: number;
    rng: RNG;
    spawnNext: number;
} =>
    tickCount < spawnTick
        ? { targets, spawnTick, rng, spawnNext }
        : (() => {
              //generates random hex value
              const { value, rng: rng1 } = randomHex(rng);
              //generates a random delay until the next spawn
              const { tickDelay, rng: rng2 } = randomDelay(rng1);
              //generates random x spawn position
              const { x, rng: rng3 } = randomPosition(rng2);
              return {
                  targets: [
                      ...targets,
                      { id: spawnNext, value, yPosition: 40, xPosition: x },
                  ],
                  spawnTick: tickCount + tickDelay,
                  rng: rng3,
                  spawnNext: spawnNext + 1,
              };
          })();

/**
 * falling checks for targets still above the check line
 * @param targets the current target
 * @returns falling targets
 */
const falling = (targets: readonly FallingTarget[]): readonly FallingTarget[] =>
    targets.filter(t => t.yPosition < FallConstants.CHECK_LINE);

/**
 * reachLine checks for what targets have already crossed the check line
 * @param targets the current target
 * @returns targets that have reached the check line
 */
const reachLine = (
    targets: readonly FallingTarget[],
): readonly FallingTarget[] =>
    targets.filter(t => t.yPosition >= FallConstants.CHECK_LINE);

/**
 * checks whether the target arriving at the check line matches the players input
 * @param arrived the targets that have crossed the check line
 * @param playerHex current digit array from the player
 * @returns true/false
 */
const wrongAnswer = (
    arrived: readonly FallingTarget[],
    playerHex: string,
    //some is used since a single wrong target will end the game
): boolean => arrived.some(t => t.value !== playerHex);

/**
 * when a digit is clicked, it is toggled to swap digits, and playerHex is updated
 * any targets that match the answer are cleared even if not at check line
 * @param s current state
 * @param index which digit was toggled
 * @returns updated state
 */
const applyDigitClick = (s: State, index: number): State => {
    const digits = digitToggle(s.digits, index);
    const playerHex = digitstoHex(digits);
    const countCorrect = countTarget(s.targets, playerHex);
    return {
        ...s,
        digits,
        playerHex,
        targets: correctTarget(s.targets, playerHex),
        score: s.score + countCorrect,
    };
};
/**
 * for each tick, various functions are called:
 * any targets that exist are moved, and a new one is spawned depending on spawn tick
 * score is changed for any new correct answers, and correct targets are cleared
 * then judges any targets that reach the check line
 * @param s current state
 * @param tickCount the current tick count, used for determining spawn timing
 * @returns updated game state
 */
const applyTick = (s: State, tickCount: number): State => {
    const moved = advanceTargets(s.targets);
    const {
        targets: spawned,
        spawnTick,
        rng,
        spawnNext,
    } = spawnNew(moved, tickCount, s.spawnTick, s.rng, s.spawnNext);
    const countCorrect = countTarget(spawned, s.playerHex);
    const cleared = correctTarget(spawned, s.playerHex);
    const arrived = reachLine(cleared);

    return {
        ...s,
        targets: falling(cleared),
        spawnTick,
        rng,
        spawnNext,
        gameEnd: wrongAnswer(arrived, s.playerHex),
        score: s.score + countCorrect,
    };
};

//used to check whether it is the RestartAction
const isRestart = (action: Action): action is RestartAction =>
    "kind" in action && action.kind === "RESTART";
/**
 * reduce scan folds every Action through
 * takes the current state and actions, and returns a new state
 * if restart is the action, it returns the initialState with new random targets
 * if game is over, it returns the current state without any modifications
 * if it was a digit click or just a tick, state is updated
 * @param s current state
 * @param action the action that was just emitted
 * @returns the next updated state
 */
const reduceState = (s: State, action: Action): State =>
    isRestart(action)
        ? initialState()
        : s.gameEnd
          ? s
          : action instanceof DigitClick
            ? applyDigitClick(s, action.index)
            : applyTick(s, action.tickCount);

// Rendering (side effects)

/**
 * Brings an SVG element to the foreground.
 * @param elem SVG element to bring to the foreground
 */
const bringToForeground = (elem: SVGElement): void => {
    elem.parentNode?.appendChild(elem);
};

/**
 * Displays a SVG element on the canvas. Brings to foreground.
 * @param elem SVG element to display
 */
const show = (elem: SVGElement): void => {
    elem.setAttribute("visibility", "visible");
    bringToForeground(elem);
};

/**
 * Hides a SVG element on the canvas.
 * @param elem SVG element to hide
 */
const hide = (elem: SVGElement): void => {
    elem.setAttribute("visibility", "hidden");
};

/**
 * Creates an SVG element with the given properties.
 *
 * See https://developer.mozilla.org/en-US/docs/Web/SVG/Element for valid
 * element names and properties.
 *
 * @param namespace Namespace of the SVG element
 * @param name SVGElement name
 * @param props Properties to set on the SVG element
 * @returns SVG element
 */
const createSvgElement = (
    namespace: string | null,
    name: string,
    props: Record<string, string> = {},
): SVGElement => {
    const elem = document.createElementNS(namespace, name) as SVGElement;
    Object.entries(props).forEach(([k, v]) => elem.setAttribute(k, v));
    return elem;
};

/**
 * Used to determine which targets need to be newly created
 * alongside which targets need to be removed
 * @param targets targets in the current state
 * @param renderID the id's being rendered currently
 * @returns which to create/to remove
 */
const targetID = (
    targets: readonly FallingTarget[],
    renderID: ReadonlySet<number>,
): { toCreate: readonly FallingTarget[]; toRemove: readonly number[] } => {
    const currentID = new Set(targets.map(t => t.id));
    return {
        //filters to targets whose id not yet rendered
        toCreate: targets.filter(t => !renderID.has(t.id)),
        //filters for ids that are no longer currently present
        toRemove: [...renderID].filter(id => !currentID.has(id)),
    };
};

//Groups the rect and text elements together, and keeps them immutable
type TargetElems = Readonly<{ rect: SVGElement; text: SVGElement }>;

/**
 * creates one rect + text pair for 1 target, appends to SVG
 * and returns a reference for future use
 * @param svg the canvas to append into
 * @returns a function creating target elem
 */
const createTargetElems =
    (svg: SVGSVGElement) =>
    (t: FallingTarget): TargetElems => {
        const rect = createSvgElement(svg.namespaceURI, "rect", {
            x: `${t.xPosition - Target.WIDTH / 2}`,
            y: "40",
            width: `${Target.WIDTH}`,
            height: `${Target.HEIGHT}`,
            rx: "6",
            fill: "white",
            stroke: "black",
            "stroke-width": "2",
        });
        const text = createSvgElement(svg.namespaceURI, "text", {
            x: `${t.xPosition}`,
            y: `${40 + Target.HEIGHT / 2 + 8}`,
            "text-anchor": "middle",
            "font-family": "monospace",
            fill: "black",
            "pointer-events": "none",
        });
        svg.appendChild(rect);
        svg.appendChild(text);
        return { rect, text };
    };

/**
 * repositions the target elem to match the current state
 * @param elems the targets existing DOM elements
 * @param t the target's current data
 */
const updateTargetElems = (elems: TargetElems, t: FallingTarget): void => {
    elems.rect.setAttribute("x", `${t.xPosition}`);
    elems.rect.setAttribute("x", `${t.xPosition - Target.WIDTH / 2}`);
    elems.rect.setAttribute("y", `${t.yPosition}`);
    elems.text.setAttribute("y", `${t.yPosition + Target.HEIGHT / 2 + 8}`);
    elems.text.textContent = t.value;
};

/**
 * removes the target's DOM elements
 * either when reaching check line, or when matched
 * @param elems the targets
 */
const removeTargetElems = (elems: TargetElems): void => {
    elems.rect.remove();
    elems.text.remove();
};

//Removes any target whose value matches the player hex
const correctTarget = (
    targets: readonly FallingTarget[],
    playerHex: string,
): readonly FallingTarget[] => targets.filter(t => t.value !== playerHex);

//Counts how many current targets match the current player hex
const countTarget = (
    targets: readonly FallingTarget[],
    playerHex: string,
): number => targets.filter(t => t.value === playerHex).length;

const render = (): ((s: State) => void) => {
    const svg = document.querySelector("#svgCanvas") as SVGSVGElement;

    svg.setAttribute(
        "viewBox",
        `0 0 ${Viewport.CANVAS_WIDTH} ${Viewport.CANVAS_HEIGHT}`,
    );
    /**
     * Renders the current state to the canvas.
     *
     * In MVC terms, this updates the View using the Model.
     *
     * @param s Current state
     */
    // Draw the row of digit toggles as a demonstration
    const digitWidth = Viewport.CANVAS_WIDTH / Constants.DIGIT_COUNT;
    const digitElems: { bit: SVGElement; bitText: SVGElement }[] = Array.from({
        length: Constants.DIGIT_COUNT,
    }).map((_, i) => {
        const bit = createSvgElement(svg.namespaceURI, "rect", {
            x: `${i * digitWidth + 4}`,
            y: `${Viewport.CANVAS_HEIGHT - 50}`,
            width: `${digitWidth - 8}`,
            height: "40",
            fill: "#ef9ace",
            stroke: "black",
            "stroke-width": "2",
            cursor: "pointer", //creates a pointer when hovering over item
            "data-digit-index": String(i), //anchor identifier for click stream
        });
        const bitText = createSvgElement(svg.namespaceURI, "text", {
            x: `${i * digitWidth + digitWidth / 2}`,
            y: `${Viewport.CANVAS_HEIGHT - 22}`,
            "text-anchor": "middle",
            "font-family": "monospace",
            fill: "black",
            "pointer-events": "none",
        });
        bitText.textContent = "0";
        svg.appendChild(bit);
        svg.appendChild(bitText);
        return { bit, bitText };
    });

    //gameOverText and scoreText both already exist as elements in index.html,
    //so they are selected rather than creating a new createSvgElement
    const gameOverText = document.querySelector("#gameOver") as SVGElement;

    const scoreText = document.querySelector("#scoreText") as HTMLElement;

    /**
     *Used to remember which target id already has DOM elements
     */
    const findTargetElem = new Map<number, TargetElems>();

    const renderTarget = (targets: readonly FallingTarget[]): void => {
        const { toCreate, toRemove } = targetID(
            targets,
            new Set(findTargetElem.keys()),
        );

        //removes elements that are no longer in the current state
        //then deletes its id since its no longer tracked
        toRemove.forEach(id => {
            const elems = findTargetElem.get(id);
            elems ? removeTargetElems(elems) : undefined;
            findTargetElem.delete(id);
        });

        //builts a new rect + text pair, and stores its id
        toCreate.forEach(t =>
            findTargetElem.set(t.id, createTargetElems(svg)(t)),
        );

        //updates each target currently visible
        targets.forEach(t => {
            const elems = findTargetElem.get(t.id);
            elems ? updateTargetElems(elems, t) : undefined;
        });
    };

    //the only thing render() returns,
    //called for each tick
    return (s: State) => {
        s.digits.forEach((val, i) => {
            const { bit, bitText } = digitElems[i];
            bitText.textContent = String(val);
        });
        scoreText.textContent = String(s.score);
        renderTarget(s.targets);
        s.gameEnd ? show(gameOverText) : hide(gameOverText);
    };
};

export const state$ = (): Observable<State> => {
    //takes raw mouse clicks and produces a mouse event
    //map takes the event.target, and filters to see if the element clicked
    //has a data-digit-index, so only digit toggles are affected
    const click$ = fromEvent<MouseEvent>(document.body, "click").pipe(
        map(event => event.target as SVGElement),
        //checks for if the digit is being clicked
        filter(target => target.hasAttribute("data-digit-index")),
        map(
            target =>
                new DigitClick(
                    parseInt(target.getAttribute("data-digit-index")!, 10),
                ),
        ), //converts into a number and wraps as a new DigitClick
    );

    const keydown$ = fromEvent<KeyboardEvent>(document.body, "keydown").pipe(
        //filters to keyboard which matches keyToIndex
        filter(e => e.key in keyToIndex),
        //looks up key index and produces a new DigitClick
        map(e => new DigitClick(keyToIndex[e.key])),
    );

    /** Determines the rate of time steps */
    const tick$ = interval(Constants.TICK_RATE_MS).pipe(
        map((tickCount): TickAction => ({ kind: "TICK", tickCount })),
    );

    const restart$ = fromEvent<KeyboardEvent>(document.body, "keydown").pipe(
        //filters for specificallly the r key for the restart action
        filter(e => e.key === "r" || e.key === "R"),
        map((): RestartAction => ({ kind: "RESTART" })),
    );

    //merges both click$ and keydown$ into one stream
    const digitAction$ = merge(click$, keydown$);

    //tick, digit action, and restart is merged into a final observable,
    //scan updates the state of the game using reduceState
    return merge(tick$, digitAction$, restart$).pipe(
        scan(reduceState, initialState()),
    );
};

// The following simply runs your main function on window load.  Make sure to leave it in place.
// You should not need to change this, beware if you are.
if (typeof window !== "undefined") {
    // Observable: wait for first user click
    const click$ = fromEvent(document.body, "mousedown").pipe(take(1));

    click$.pipe(switchMap(() => state$())).subscribe(render());
}
