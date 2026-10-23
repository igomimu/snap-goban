import { BoardState, StoneColor } from "../components/GoBoard";

/*
  Simple SGF Generator/Parser for Snap Goban.
  Focuses on:
  1. AB[...], AW[...] for stone placement.
  2. LB[...] for numbered stones in diagram mode.
  3. SZ[...] for board size.
  
  Does NOT currently support full game tree recursion, just the current board state snapshot.
  When loading, it will try to place stones from AB/AW/B/W properties.
*/

// Convert Grid (1-based) to SGF Coordinate (a-s)
// e.g. 1->a, 19->s
// Convert Grid (1-based) to SGF Coordinate (a-s)
// e.g. 1->a, 19->s
export function toSgfCoord(c: number): string {
    if (c < 1 || c > 26) return '';
    return String.fromCharCode(96 + c); // 'a' is 97. 96+1 = 97.
}

function fromSgfCoord(c: string): number {
    if (!c || c.length < 1) return -1;
    const code = c.toLowerCase().charCodeAt(0);
    return code - 96; // 'a'(97) - 96 = 1.
}

export interface SgfNode {
    type: 'MOVE' | 'SETUP';
    // For MOVE
    color?: StoneColor;
    coord?: string;
    number?: number;
    // For SETUP
    ab?: string[];
    aw?: string[];
    ae?: string[];
    lb?: string[]; // Label [aa:A]
    tr?: string[]; // Triangle
    cr?: string[]; // Circle
    sq?: string[]; // Square
    ma?: string[]; // Mark (X)
}

export interface SgfMetadata {
    gameName?: string; // GN
    event?: string; // EV
    date?: string; // DT
    place?: string; // PC
    round?: string; // RO
    blackName?: string; // PB
    blackRank?: string; // BR
    blackTeam?: string; // BT
    whiteName?: string; // PW
    whiteRank?: string; // WR
    whiteTeam?: string; // WT
    komi?: string; // KM
    handicap?: string; // HA
    result?: string; // RE
    time?: string; // TM
    user?: string; // US
    source?: string; // SO
    gameComment?: string; // GC
    copyright?: string; // CP
    annotation?: string; // AN
}

export function generateSGF(initialBoard: BoardState, size: number, nodes: SgfNode[], metadata?: SgfMetadata): string {
    let sgf = `(;GM[1]FF[4]SZ[${size}]`;

    // Metadata
    if (metadata) {
        if (metadata.gameName) sgf += `GN[${metadata.gameName}]`;
        if (metadata.event) sgf += `EV[${metadata.event}]`;
        if (metadata.date) sgf += `DT[${metadata.date}]`;
        if (metadata.place) sgf += `PC[${metadata.place}]`;
        if (metadata.round) sgf += `RO[${metadata.round}]`;
        if (metadata.blackName) sgf += `PB[${metadata.blackName}]`;
        if (metadata.blackRank) sgf += `BR[${metadata.blackRank}]`;
        if (metadata.blackTeam) sgf += `BT[${metadata.blackTeam}]`;
        if (metadata.whiteName) sgf += `PW[${metadata.whiteName}]`;
        if (metadata.whiteRank) sgf += `WR[${metadata.whiteRank}]`;
        if (metadata.whiteTeam) sgf += `WT[${metadata.whiteTeam}]`;
        if (metadata.komi) sgf += `KM[${metadata.komi}]`;
        if (metadata.handicap) sgf += `HA[${metadata.handicap}]`;
        if (metadata.result) sgf += `RE[${metadata.result}]`;
        if (metadata.time) sgf += `TM[${metadata.time}]`;
        if (metadata.user) sgf += `US[${metadata.user}]`;
        if (metadata.source) sgf += `SO[${metadata.source}]`;
        if (metadata.gameComment) sgf += `GC[${metadata.gameComment}]`;
        if (metadata.copyright) sgf += `CP[${metadata.copyright}]`;
        if (metadata.annotation) sgf += `AN[${metadata.annotation}]`;
    }

    // 1. Initial Setup (AB/AW) from initialBoard
    const ab: string[] = [];
    const aw: string[] = [];

    for (let y = 1; y <= size; y++) {
        for (let x = 1; x <= size; x++) {
            const stone = initialBoard[y - 1][x - 1];
            if (stone) {
                const c = `${toSgfCoord(x)}${toSgfCoord(y)}`;
                if (stone.color === 'BLACK') ab.push(c);
                else aw.push(c);
            }
        }
    }

    if (ab.length > 0) sgf += `AB` + ab.map(c => `[${c}]`).join('');
    if (aw.length > 0) sgf += `AW` + aw.map(c => `[${c}]`).join('');

    // 2. Append Nodes
    for (const node of nodes) {
        let nodeStr = ';';
        if (node.type === 'MOVE') {
            const c = node.color === 'BLACK' ? 'B' : 'W';
            // If coord is empty/missing, it's a pass? Or just omit.
            // But usually we have a coord.
            nodeStr += `${c}[${node.coord || ''}]`;
            // Optional: Comment with move number?
            // nodeStr += `C[${node.number}]`; 
        }

        // Setup properties (AB/AW/AE) can be on Move nodes or standalone SGF nodes.
        // Usually edits happen in between moves. SGF Move Node can *also* have AB/AW, 
        // but typically edits are separate nodes or attached to the move.
        // Let's attach if present.
        if (node.ab && node.ab.length > 0) nodeStr += `AB` + node.ab.map(c => `[${c}]`).join('');
        if (node.aw && node.aw.length > 0) nodeStr += `AW` + node.aw.map(c => `[${c}]`).join('');
        if (node.ae && node.ae.length > 0) nodeStr += `AE` + node.ae.map(c => `[${c}]`).join('');

        // Annotations
        if (node.lb && node.lb.length > 0) nodeStr += `LB` + node.lb.map(c => `[${c}]`).join('');
        if (node.tr && node.tr.length > 0) nodeStr += `TR` + node.tr.map(c => `[${c}]`).join('');
        if (node.cr && node.cr.length > 0) nodeStr += `CR` + node.cr.map(c => `[${c}]`).join('');
        if (node.sq && node.sq.length > 0) nodeStr += `SQ` + node.sq.map(c => `[${c}]`).join('');
        if (node.ma && node.ma.length > 0) nodeStr += `MA` + node.ma.map(c => `[${c}]`).join('');

        if (nodeStr !== ';') {
            sgf += nodeStr;
        }
    }

    sgf += `)`;
    return sgf;
}

export interface SgfMove {
    x: number;
    y: number;
    color: StoneColor;
}

export interface ParsedSGF {
    board: BoardState; // Initial Setup
    moves: SgfMove[];  // Move Sequence
    size: number;
    metadata?: SgfMetadata;
}

export function parseSGF(sgfContent: string): ParsedSGF {
    // Basic Parsing: Just Regex for now?
    // Robust SGF parsing is hard, but for "Load SGF" feature often used for diagrams, 
    // we mostly care about SZ, AB, AW, LB.
    // If B/W moves exist, we should process them sequentially if we want to support "Game Record".
    // But for now, let's just parse the static setup if `AB/AW` exists.
    // If no AB/AW, but B/W exist, we replay?
    // User requirement: "SGF reading function". "Save and Load".
    // Usually loading implies restoring the STATE.

    // 1. Determine Size
    let size = 19;
    const szMatch = sgfContent.match(/SZ\[(\d+)\]/);
    if (szMatch) {
        size = parseInt(szMatch[1]);
        if (isNaN(size) || size < 1) size = 19;
    }

    // Metadata extraction
    const getTag = (tag: string) => {
        // Handle escaped brackets? SGF escaping is backslash.
        // For simple metadata, greedy match is dangerous. Non-greedy `.+?` inside brackets.
        // But SGF values can contain `]`.
        // Simple regex with `[^\]]+` fails on `[a\]b]`.
        // Let's stick to simple regex for now as most metadata is simple text.
        const m = sgfContent.match(new RegExp(`${tag}\\[([^\\]]*)\\]`));
        return m ? m[1] : undefined;
    };

    const metadata: SgfMetadata = {
        gameName: getTag('GN'),
        event: getTag('EV'),
        date: getTag('DT'),
        place: getTag('PC'),
        round: getTag('RO'),
        blackName: getTag('PB'),
        blackRank: getTag('BR'),
        blackTeam: getTag('BT'),
        whiteName: getTag('PW'),
        whiteRank: getTag('WR'),
        whiteTeam: getTag('WT'),
        komi: getTag('KM'),
        handicap: getTag('HA'),
        result: getTag('RE'),
        time: getTag('TM'),
        user: getTag('US'),
        source: getTag('SO'),
        gameComment: getTag('GC'),
        copyright: getTag('CP'),
        annotation: getTag('AN'),
    };

    // Initialize Board (Setup State)
    const board: BoardState = Array(size).fill(null).map(() => Array(size).fill(null));

    // Helper to place stone (for setup)
    const place = (coord: string, color: StoneColor) => {
        if (coord.length < 2) return;
        const x = fromSgfCoord(coord[0]);
        const y = fromSgfCoord(coord[1]);
        if (x >= 1 && x <= size && y >= 1 && y <= size) {
            // Check if stone exists? Overwrite.
            // Preserve existing number if just coloring? No, new stone kills old data.
            board[y - 1][x - 1] = { color };
        }
    };

    // 2. Parse Add Black / Add White (Setup)
    // Regex for property blocks: AB[aa][bb]...
    // Note: SGF properties can be split or have multiple values.
    // e.g. AB[aa][bb]

    // Simple parser: iterating strings might be safer than regex for nested brackets.
    // But regex `AB((?:\[[a-z]{2}\])+)` captures the whole block.

    const parseSetup = (prop: string, color: StoneColor) => {
        const regex = new RegExp(`${prop}((?:-?\\[[a-zA-Z0-9:]+\\])+)`, 'g');
        let match;
        while ((match = regex.exec(sgfContent)) !== null) {
            const pointsBlock = match[1];
            const pointRegex = /\[([a-zA-Z]{2})\]/g;
            let pMatch;
            while ((pMatch = pointRegex.exec(pointsBlock)) !== null) {
                place(pMatch[1], color);
            }
        }
    };

    parseSetup('AB', 'BLACK');
    parseSetup('AW', 'WHITE');

    // 3. Parse Moves (B[aa], W[bb])
    // If it's a game record, we replay moves to handle captures and numbering.
    const moves: SgfMove[] = [];
    const moveRegex = /;(B|W)\[([a-zA-Z]{2})\]/g;
    let moveMatch;
    // let moveNumber = 1; // No longer needed here, moves are just extracted.

    while ((moveMatch = moveRegex.exec(sgfContent)) !== null) {
        const colorChar = moveMatch[1];
        const color = colorChar === 'B' ? 'BLACK' : 'WHITE';
        const coord = moveMatch[2];

        if (coord.length >= 2) {
            const x = fromSgfCoord(coord[0]);
            const y = fromSgfCoord(coord[1]);

            if (x >= 1 && x <= size && y >= 1 && y <= size) {
                // Do NOT place stone or check captures here. Just record the move.
                moves.push({ x, y, color });
            }
        }
    }

    // 4. Parse Labels (LB[aa:1][bb:2]) - Apply to Setup Board
    const labelRegex = /LB((?:\[[a-zA-Z0-9:]+\])+)/g;
    let lbMatch;
    while ((lbMatch = labelRegex.exec(sgfContent)) !== null) {
        const block = lbMatch[1];
        const itemRegex = /\[([a-zA-Z]{2}):(.+?)\]/g;
        let itemMatch;
        while ((itemMatch = itemRegex.exec(block)) !== null) {
            const coord = itemMatch[1];
            const label = itemMatch[2];

            const x = fromSgfCoord(coord[0]);
            const y = fromSgfCoord(coord[1]);
            if (x >= 1 && x <= size && y >= 1 && y <= size) {
                const stone = board[y - 1][x - 1];
                const num = parseInt(label);
                if (stone && !isNaN(num)) {
                    stone.number = num;
                }
                // If labeling an empty spot?
                // Snap Goban supports numbered stones. Does it support numbered empty spots?
                // Code: `if (stone) { ... {stone.number} ... }`.
                // So we can only label stones. Ignoring empty labels for now.
            }
        }
    }

    return { board, moves, size, metadata };
}

// ===== NEW: Tree-based SGF Parsing for Branch Support =====

export interface SgfTreeNode {
    move?: SgfMove;
    setup?: { ab: string[], aw: string[], ae: string[] };
    markers?: { x: number, y: number, type: string, value: string }[];
    children: SgfTreeNode[];
}

export interface ParsedSGFTree {
    board: BoardState;
    size: number;
    metadata?: SgfMetadata;
    root: SgfTreeNode;
}

export function parseSGFTree(sgfContent: string): ParsedSGFTree {
    // 1. Determine Size
    let size = 19;
    const szMatch = sgfContent.match(/SZ\[(\d+)\]/);
    if (szMatch) {
        size = parseInt(szMatch[1]);
        if (isNaN(size) || size < 1) size = 19;
    }

    // 2. Parse Metadata
    const getTag = (tag: string) => {
        const m = sgfContent.match(new RegExp(`${tag}\\[([^\\]]*)\\]`));
        return m ? m[1] : undefined;
    };

    const metadata: SgfMetadata = {
        gameName: getTag('GN'),
        event: getTag('EV'),
        date: getTag('DT'),
        place: getTag('PC'),
        round: getTag('RO'),
        blackName: getTag('PB'),
        blackRank: getTag('BR'),
        blackTeam: getTag('BT'),
        whiteName: getTag('PW'),
        whiteRank: getTag('WR'),
        whiteTeam: getTag('WT'),
        komi: getTag('KM'),
        handicap: getTag('HA'),
        result: getTag('RE'),
        time: getTag('TM'),
        user: getTag('US'),
        source: getTag('SO'),
        gameComment: getTag('GC'),
        copyright: getTag('CP'),
        annotation: getTag('AN'),
    };

    // 3. Initial Board setup
    const board: BoardState = Array(size).fill(null).map(() => Array(size).fill(null));

    const place = (coord: string, color: StoneColor) => {
        if (coord.length < 2) return;
        const x = fromSgfCoord(coord[0]);
        const y = fromSgfCoord(coord[1]);
        if (x >= 1 && x <= size && y >= 1 && y <= size) {
            board[y - 1][x - 1] = { color };
        }
    };

    // Read only the root node. Bracketed values may contain escaped brackets
    // or tree delimiters, so those must not terminate the root properties.
    const rootMatch = sgfContent.match(/\(\s*;((?:\[(?:\\[\s\S]|[^\\\]])*\]|[^;()[\]])*)/);
    const rootProperties = rootMatch?.[1] || '';
    // Consume every property (including comments), then inspect AB/AW values.
    // MultiGo wraps value lists across lines and may repeat AB in the root.
    const propertyRegex = /([A-Z]+)\s*((?:\[(?:\\[\s\S]|[^\\\]])*\]\s*)+)/g;
    for (const property of rootProperties.matchAll(propertyRegex)) {
        if (property[1] !== 'AB' && property[1] !== 'AW') continue;
        const color = property[1] === 'AB' ? 'BLACK' : 'WHITE';
        for (const point of property[2].matchAll(/\[([a-zA-Z]{2})\]/g)) {
            place(point[1], color);
        }
    }

    // 4. Parse tree structure
    const root: SgfTreeNode = { children: [] };

    // Find the main content after first (; 
    const startIdx = sgfContent.indexOf('(');
    if (startIdx === -1) {
        return { board, size, metadata, root };
    }

    // Recursive parser
    function parseVariation(content: string, startPos: number): { node: SgfTreeNode, endPos: number } {
        const node: SgfTreeNode = { children: [] };
        let pos = startPos;

        // Skip whitespace
        while (pos < content.length && /\s/.test(content[pos])) pos++;

        // Expect ; for a node
        if (content[pos] === ';') {
            pos++; // Skip ;

            // Parse properties until next ; or ( or )
            let propBuffer = '';
            while (pos < content.length && content[pos] !== ';' && content[pos] !== '(' && content[pos] !== ')') {
                propBuffer += content[pos];
                pos++;
            }

            // Extract move from propBuffer
            const bMatch = propBuffer.match(/B\[([a-zA-Z]*)\]/);
            const wMatch = propBuffer.match(/W\[([a-zA-Z]*)\]/);

            if (bMatch) {
                const coord = bMatch[1];
                let x = 0, y = 0;
                if (coord.length >= 2) {
                    x = fromSgfCoord(coord[0]);
                    y = fromSgfCoord(coord[1]);
                }
                // Pass if coord is empty (x=0, y=0)
                if ((x === 0 && y === 0) || (x >= 1 && x <= size && y >= 1 && y <= size)) {
                    node.move = { x, y, color: 'BLACK' };
                }
            } else if (wMatch) {
                const coord = wMatch[1];
                let x = 0, y = 0;
                if (coord.length >= 2) {
                    x = fromSgfCoord(coord[0]);
                    y = fromSgfCoord(coord[1]);
                }
                if ((x === 0 && y === 0) || (x >= 1 && x <= size && y >= 1 && y <= size)) {
                    node.move = { x, y, color: 'WHITE' };
                }
            }
        }

        // Now handle children: either more ; nodes or ( variations
        while (pos < content.length) {
            // Skip whitespace
            while (pos < content.length && /\s/.test(content[pos])) pos++;

            if (pos >= content.length || content[pos] === ')') {
                break;
            }

            if (content[pos] === ';') {
                // Continue with child node
                const result = parseVariation(content, pos);
                node.children.push(result.node);
                pos = result.endPos;
            } else if (content[pos] === '(') {
                // Start of variation
                pos++; // Skip (
                const result = parseVariation(content, pos);
                node.children.push(result.node);
                pos = result.endPos;
                // Skip past closing )
                if (pos < content.length && content[pos] === ')') pos++;
            } else {
                pos++;
            }
        }

        return { node, endPos: pos };
    }

    // Continue after the same root section used for initial setup.
    let parsePos = rootMatch ? rootMatch.index! + rootMatch[0].length : sgfContent.length;

    // Now parse the moves
    while (parsePos < sgfContent.length && sgfContent[parsePos] !== ')') {
        if (sgfContent[parsePos] === ';' || sgfContent[parsePos] === '(') {
            if (sgfContent[parsePos] === '(') parsePos++; // Skip (
            const result = parseVariation(sgfContent, parsePos);
            root.children.push(result.node);
            parsePos = result.endPos;
            if (parsePos < sgfContent.length && sgfContent[parsePos] === ')') parsePos++;
        } else {
            parsePos++;
        }
    }

    return { board, size, metadata, root };
}

// ===== SGF Tree Generator =====

export interface GenericGameNode {
    move?: { x: number, y: number, color: StoneColor };
    children: GenericGameNode[];
    markers?: { x: number, y: number, type: string, value: string }[];
    board?: BoardState;
}

export function generateSGFTree(root: GenericGameNode, size: number, metadata?: SgfMetadata): string {
    let sgf = `(;GM[1]FF[4]SZ[${size}]`;

    // Metadata
    if (metadata) {
        if (metadata.gameName) sgf += `GN[${metadata.gameName}]`;
        if (metadata.event) sgf += `EV[${metadata.event}]`;
        if (metadata.date) sgf += `DT[${metadata.date}]`;
        if (metadata.place) sgf += `PC[${metadata.place}]`;
        if (metadata.round) sgf += `RO[${metadata.round}]`;
        if (metadata.blackName) sgf += `PB[${metadata.blackName}]`;
        if (metadata.blackRank) sgf += `BR[${metadata.blackRank}]`;
        if (metadata.blackTeam) sgf += `BT[${metadata.blackTeam}]`;
        if (metadata.whiteName) sgf += `PW[${metadata.whiteName}]`;
        if (metadata.whiteRank) sgf += `WR[${metadata.whiteRank}]`;
        if (metadata.whiteTeam) sgf += `WT[${metadata.whiteTeam}]`;
        if (metadata.komi) sgf += `KM[${metadata.komi}]`;
        if (metadata.handicap) sgf += `HA[${metadata.handicap}]`;
        if (metadata.result) sgf += `RE[${metadata.result}]`;
        if (metadata.time) sgf += `TM[${metadata.time}]`;
        if (metadata.user) sgf += `US[${metadata.user}]`;
        if (metadata.source) sgf += `SO[${metadata.source}]`;
        if (metadata.gameComment) sgf += `GC[${metadata.gameComment}]`;
        if (metadata.copyright) sgf += `CP[${metadata.copyright}]`;
        if (metadata.annotation) sgf += `AN[${metadata.annotation}]`;
    }

    if (root.board) {
        const ab: string[] = [];
        const aw: string[] = [];
        for (let y = 1; y <= size; y++) {
            for (let x = 1; x <= size; x++) {
                if (!root.board[y - 1]) continue; // Safety check
                const stone = root.board[y - 1][x - 1];
                if (stone && !stone.number) { // Only Setup stones (no number)
                    const c = `${toSgfCoord(x)}${toSgfCoord(y)}`;
                    if (stone.color === 'BLACK') ab.push(c);
                    else aw.push(c);
                }
            }
        }
        if (ab.length > 0) sgf += `AB` + ab.map(c => `[${c}]`).join('');
        if (aw.length > 0) sgf += `AW` + aw.map(c => `[${c}]`).join('');
    }

    // Helper to generate node content
    const generateNodeContent = (node: GenericGameNode): string => {
        let content = '';
        if (node.move) {
            const c = node.move.color === 'BLACK' ? 'B' : 'W';
            const coord = `${toSgfCoord(node.move.x)}${toSgfCoord(node.move.y)}`;
            content += `;${c}[${coord}]`;
        }
        return content;
    };

    // Recursive traversal
    const traverse = (node: GenericGameNode): string => {
        let branchStr = '';

        // Children
        if (node.children.length === 0) {
            return '';
        } else if (node.children.length === 1) {
            // Single child - Linear
            const child = node.children[0];
            branchStr += generateNodeContent(child);
            branchStr += traverse(child);
        } else {
            // Multiple children - Branched
            for (const child of node.children) {
                branchStr += `(`;
                branchStr += generateNodeContent(child);
                branchStr += traverse(child);
                branchStr += `)`;
            }
        }
        return branchStr;
    };

    sgf += traverse(root);
    sgf += `)`;

    return sgf;
}
