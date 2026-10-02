import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { flushSync } from 'react-dom'
import GoBoard, { ViewRange, BoardState, StoneColor, Marker, Stone } from './components/GoBoard'
import GameInfoModal from './components/GameInfoModal'
import PrintSettingsModal, { PrintSettings } from './components/PrintSettingsModal'
import GlobalTooltip from './components/Tooltip'
import { exportToPng, exportToSvg, exportToEmf, prepareSvgForExport, svgToPngBlob } from './utils/exportUtils'
import { createGifFromImages } from './utils/gifExportUtils'
import { checkCaptures } from './utils/gameLogic'
import { saveLastDirHandle, loadLastDirHandle } from './utils/lastDirStore'
import { parseSGFTree, generateSGFTree, SgfTreeNode } from './utils/sgfUtils'
import { generatePrintFigures } from './utils/printUtils'
import { getPhoto } from './utils/kishiPhotoStore'
import { APP_VERSION, DEV_VERSION } from './constants'
import { useTranslation, Language, languageNames } from './i18n'

// Chrome extension download API (type stub)
declare const chrome: any;

// Notify user where the downloads API saved the file (best-effort)
const notifyDownloadLocation = (downloadId: number, onNotify?: (path: string) => void) => {
    try {
        if (chrome?.downloads?.search) {
            chrome.downloads.search({ id: downloadId }, (results: any[]) => {
                const path = results?.[0]?.filename;
                if (path && onNotify) {
                    onNotify(path);
                }
            });
        }
    } catch (err) {
        console.warn('Failed to fetch download location', err);
    }
};

type PlacementMode = 'SIMPLE' | 'NUMBERED';

export type ToolMode = 'STONE' | 'LABEL' | 'SYMBOL';
export type SymbolType = 'TRI' | 'CIR' | 'SQR' | 'X';

export interface HistoryState {
    board: BoardState;
    nextNumber: number;
    activeColor: StoneColor;
    boardSize: number;
    markers?: Marker[];
}

import { createNode, getPath, addMove, GameNode, recalculateBoards, getPathWithBranches } from './utils/treeUtilsV2'

function App() {
    const { t, language, setLanguage } = useTranslation();
    // Initial Size 19
    const INITIAL_SIZE = 19;

    // Load initial active color from localStorage
    const getInitialColor = (): StoneColor => {
        try {
            const saved = localStorage.getItem('gorw_active_color');
            return (saved === 'WHITE' ? 'WHITE' : 'BLACK');
        } catch (e) {
            return 'BLACK';
        }
    };

    const [toolMode, setToolMode] = useState<ToolMode>('STONE');
    const [isPrintJob, setIsPrintJob] = useState(false);
    const [printBlackPhoto, setPrintBlackPhoto] = useState<string | null>(null);
    const [printWhitePhoto, setPrintWhitePhoto] = useState<string | null>(null);
    const [nextLabelChar, setNextLabelChar] = useState<string>('A');
    const [selectedSymbol, setSelectedSymbol] = useState<SymbolType>('TRI');
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    // -- Tree State --
    // We initialize a Root Node instead of a linear history array.
    const [rootNode, setRootNode] = useState<GameNode>(() =>
        createNode(null, Array(INITIAL_SIZE).fill(null).map(() => Array(INITIAL_SIZE).fill(null)), 1, getInitialColor(), INITIAL_SIZE)
    );
    const [currentNodeId, setCurrentNodeId] = useState<string>(rootNode.id);

    // Derive History (Path from Root to Current)
    const history = useMemo(() => getPath(rootNode, currentNodeId), [rootNode, currentNodeId]);

    // Indices and Current State
    const currentMoveIndex = history.length - 1;
    const currentState = history[currentMoveIndex] || rootNode; // Fallback to root if empty (shouldn't happen)

    const board = currentState.board;
    const nextNumber = currentState.nextNumber;
    const activeColor = currentState.activeColor;
    const boardSize = currentState.boardSize;

    // ViewRange / Crop Logic
    const [viewRange, setViewRange] = useState<ViewRange | null>(null);
    const effectiveViewRange: ViewRange = viewRange || { minX: 1, maxX: boardSize, minY: 1, maxY: boardSize };
    const isCropped = !!viewRange;

    const [showCoordinates, setShowCoordinates] = useState(false);
    const [showNumbers, setShowNumbers] = useState(true);
    const [showHelp, setShowHelp] = useState(false);
    const [mode, setMode] = useState<PlacementMode>('SIMPLE');

    // ... (Retention of other states like isMonochrome, exportMode ...)
    const [isMonochrome, setIsMonochrome] = useState(() => {
        try { return localStorage.getItem('gorw_is_monochrome') === 'true'; } catch { return false; }
    });
    const [exportMode, setExportMode] = useState<'SVG' | 'PNG' | 'EMF'>(() => {
        try { const saved = localStorage.getItem('gorw_export_mode'); return (saved === 'SVG' || saved === 'PNG' || saved === 'EMF') ? (saved as any) : 'SVG'; } catch { return 'SVG'; }
    });

    const [showCapturedInExport, setShowCapturedInExport] = useState(true);
    const [isPlaying, setIsPlaying] = useState(false);
    const [playbackSpeed, setPlaybackSpeed] = useState(800); // ms per move (Default 0.8s)

    const [isFigureMode, setIsFigureMode] = useState(false); // Internal State for Export Auto-Switch
    const [isGifExporting, setIsGifExporting] = useState(false);
    const [gifProgress, setGifProgress] = useState(0);

    // Clear confirm modal state
    const [showClearConfirm, setShowClearConfirm] = useState(false);

    // Toast notification state
    const [toast, setToast] = useState<{message: string, type: 'success'|'error'|'info'} | null>(null);
    const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const showToast = useCallback((message: string, type: 'success'|'error'|'info' = 'info') => {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        setToast({ message, type });
        toastTimerRef.current = setTimeout(() => setToast(null), 3000);
    }, []);

    // Auto-Play Effect
    useEffect(() => {
        let intervalId: any;
        if (isPlaying) {
            intervalId = setInterval(() => {
                // Determine if we can step forward
                // calculate "next"
                if (currentState.children.length > 0) {
                    setCurrentNodeId(currentState.children[0].id);
                } else {
                    // Stop if no more moves
                    setIsPlaying(false);
                }
            }, playbackSpeed);
        }
        return () => clearInterval(intervalId);
    }, [isPlaying, currentState, playbackSpeed]);

    // Version Display Logic
    const [displayVersion, setDisplayVersion] = useState(`v${APP_VERSION}`);
    const [isDevMode, setIsDevMode] = useState(false);

    useEffect(() => {
        // Check if we are in development mode
        if (chrome?.management?.getSelf) {
            chrome.management.getSelf((info: any) => {
                if (info?.installType === 'development') {
                    setDisplayVersion(`Dev ${DEV_VERSION}`);
                    setIsDevMode(true);
                }
            });
        }
    }, []);


    // Show help on first visit
    useEffect(() => {
        try {
            if (!localStorage.getItem('gorw_first_visit')) {
                setShowHelp(true);
                localStorage.setItem('gorw_first_visit', 'true');
            }
        } catch { /* ignore */ }
    }, []);

    useEffect(() => { localStorage.setItem('gorw_is_monochrome', String(isMonochrome)); }, [isMonochrome]);

    const [saveFileHandle, setSaveFileHandle] = useState<any>(null);
    const lastDirHandleRef = useRef<any>(null);

    // 起動時にIndexedDBから前回のファイルハンドルを復元
    useEffect(() => {
        loadLastDirHandle().then(h => { if (h) lastDirHandleRef.current = h; });
    }, []);

    // ファイルハンドル変更時にIndexedDBへ永続化
    useEffect(() => {
        if (saveFileHandle) {
            lastDirHandleRef.current = saveFileHandle;
            saveLastDirHandle(saveFileHandle);
        }
    }, [saveFileHandle]);

    // Drag State
    type DragMode = 'SELECTING' | 'MOVING_STONE' | 'MOVING_SELECTION';
    const [dragMode, setDragMode] = useState<DragMode>('SELECTING');
    const [isSelecting, setIsSelecting] = useState(false);
    const [selectionStart, setSelectionStart] = useState<{ x: number, y: number } | null>(null);
    const [selectionEnd, setSelectionEnd] = useState<{ x: number, y: number } | null>(null);
    const [originalSelection, setOriginalSelection] = useState<{ start: { x: number, y: number }, end: { x: number, y: number } } | null>(null);
    const [moveSource, setMoveSource] = useState<{ x: number, y: number } | null>(null);

    const svgRef = useRef<SVGSVGElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragStartRef = useRef<{ x: number, y: number } | null>(null);
    const hoveredCellRef = useRef<{ x: number, y: number } | null>(null);
    const [showNextMove, setShowNextMove] = useState(false);



    // Replaced commitState with Tree Logic
    const commitState = (newBoard: BoardState, newNextNumber: number, newActiveColor: StoneColor, newSize: number, newMarkers?: Marker[], move?: { x: number, y: number, color: StoneColor }) => {
        try { localStorage.setItem('gorw_active_color', newActiveColor); } catch (e) { }

        // If we have a 'move', we use addMove logic to support branching.
        // If it's a generic commit (like resizing or simple mode setup), we might need special handling.

        // Strategy:
        // 1. If Move is provided, use addMove (Branches if needed).
        // 2. If NO Move (e.g. Setup Mode edit, Resize), we might be modifying the Current Node in place?
        //    Or adding a "Modification Node"?
        //    For Setup Mode: usually we edit the Root.
        //    For "Pass": it's a move without coords? Or just state change?

        if (move) {
            // Branching Logic
            const newNode = addMove(currentState, newBoard, newNextNumber, newActiveColor, newSize, move);
            // Force Update (Since addMove mutates tree)
            setRootNode({ ...rootNode });
            setCurrentNodeId(newNode.id);
        } else {
            // Non-branching update (e.g. Marker update, Setup change, Resize)
            // We treat this as "Modifying current node".
            // WARNING: If we modify a node with children, we might break consistency.
            // For Markers: Safe.
            // For Setup (Root): Need propagation.

            // For now, let's just update the Current Node's data.
            currentState.board = newBoard;
            currentState.nextNumber = newNextNumber;
            currentState.activeColor = newActiveColor;
            currentState.boardSize = newSize;
            if (newMarkers) currentState.markers = newMarkers;

            // If we are at Root (Setup) and changed board, we must recalculate children.
            if (currentState === rootNode && mode === 'SIMPLE') {
                recalculateBoards(currentState);
            }

            setRootNode({ ...rootNode }); // Trigger Render
        }
    };

    // Change Board Size
    // Change Board Size
    const setBoardSize = (size: number) => {
        // Reset Tree
        const newRoot = createNode(null, Array(size).fill(null).map(() => Array(size).fill(null)), 1, 'BLACK', size);
        setRootNode(newRoot);
        setCurrentNodeId(newRoot.id);
    };



    // Interaction Handlers (Tree Adapted)

    // Helper: Modify Root Board (Setup Mode)
    const modifyRootBoard = (modifier: (board: BoardState) => void) => {
        const newRootBoard = rootNode.board.map((row: (Stone | null)[]) => row.map((c: Stone | null) => c ? { ...c } : null));
        modifier(newRootBoard);

        // Update Root
        rootNode.board = newRootBoard;
        // Propagate
        recalculateBoards(rootNode);
        setRootNode({ ...rootNode }); // Trigger Render
        // Current Node stays same (tracking the updated branch)
    };

    const handleInteraction = (x: number, y: number) => {
        if (dragStartRef.current) {
            const dx = Math.abs(dragStartRef.current.x - x);
            const dy = Math.abs(dragStartRef.current.y - y);
            if (dx > 0 || dy > 0) return;
        }
        if (selectionStart && selectionEnd) { setSelectionStart(null); setSelectionEnd(null); }

        // Markers
        if (toolMode === 'LABEL' || toolMode === 'SYMBOL') {
            const currentMarkers = currentState.markers || [];
            const existingIndex = currentMarkers.findIndex((m: Marker) => m.x === x && m.y === y);
            const newMarkers = [...currentMarkers];

            if (existingIndex !== -1) newMarkers.splice(existingIndex, 1);
            else {
                if (toolMode === 'LABEL') {
                    newMarkers.push({ x, y, type: 'LABEL', value: nextLabelChar });
                    setNextLabelChar(String.fromCharCode(nextLabelChar.charCodeAt(0) + 1));
                } else {
                    newMarkers.push({ x, y, type: 'SYMBOL', value: selectedSymbol });
                }
            }
            commitState(currentState.board, nextNumber, activeColor, boardSize, newMarkers);
            return;
        }

        const currentStone = board[y - 1][x - 1];

        if (mode === 'SIMPLE') {
            // Setup Mode: Edit Root
            modifyRootBoard((b) => {
                const cell = b[y - 1][x - 1];
                if (cell && !cell.number) {
                    // Delete Simple/Setup stone
                    b[y - 1][x - 1] = null;
                } else if (!cell || (cell.number)) {
                    // Place the selected setup color if empty.
                    // Note: If numbered stone is there, we usually ignore or shouldn't be in Setup mode?
                    // Old logic: deleted setup stone if overlapping. Placed if not.
                    if (!cell || !cell.number) {
                        b[y - 1][x - 1] = { color: activeColor };
                    }
                }
            });
            return;
        } else {
            // Numbered Mode
            // L-Click: Place Stone (Add Move)

            if (currentStone) {
                // Determine if this stone is the LAST move (Undo)
                // Note: In Tree, "Last Node" is current node.
                // Does current node have a move at x,y?
                if (currentState.move && currentState.move.x === x && currentState.move.y === y) {
                    // It IS the last move. Undo (Step Back).
                    stepBack();
                    return;
                }
                return; // Ignore other stones
            }

            // Place Numbered Stone
            // We calculate NEW state to pass to commitState
            const newBoard = board.map((row: (Stone | null)[]) => row.map((c: Stone | null) => c ? { ...c } : null));
            newBoard[y - 1][x - 1] = { color: activeColor, number: nextNumber };

            const captured = checkCaptures(newBoard, x - 1, y - 1, activeColor);
            captured.forEach(c => newBoard[c.y][c.x] = null);

            const newNextNum = nextNumber + 1;
            const newActiveColor = activeColor === 'BLACK' ? 'WHITE' : 'BLACK';

            commitState(newBoard, newNextNum, newActiveColor, boardSize, [], { x, y, color: activeColor });
        }
    };

    const handleRightClick = (x: number, y: number) => {
        if (mode === 'SIMPLE') {
            modifyRootBoard((b) => {
                const cell = b[y - 1][x - 1];
                if (cell && !cell.number) {
                    b[y - 1][x - 1] = null;
                } else if (!cell || !cell.number) {
                    b[y - 1][x - 1] = { color: 'WHITE' };
                }
            });
            return;
        } else {
            // Numbered Mode: Undo if last move
            if (currentState.move && currentState.move.x === x && currentState.move.y === y) {
                stepBack();
            }
        }
    };

    const handleDoubleClick = () => {
        // ... (Simplified: Only Setup Mode toggle supported for now to save space/complexity)
        if (mode === 'SIMPLE' && toolMode === 'STONE') {
            if (hoveredCellRef.current) {
                const { x, y } = hoveredCellRef.current;
                modifyRootBoard((b) => {
                    const cell = b[y - 1][x - 1];
                    if (cell && !cell.number) {
                        // Toggle
                        cell.color = (cell.color === 'BLACK' ? 'WHITE' : 'BLACK');
                    }
                });
            }
        }
    };

    // Pass Move (not fully implemented in Tree, just alert for now)
    // Pass Move implementation
    const handlePass = () => {
        if (mode !== 'NUMBERED') return;

        // Create new board state (unchanged)
        const newBoard = board.map((row: (Stone | null)[]) => row.map((c: Stone | null) => c ? { ...c } : null));

        const newNextNum = nextNumber + 1;
        const newActiveColor = activeColor === 'BLACK' ? 'WHITE' : 'BLACK';

        // Commit PASS move (x=0, y=0)
        commitState(newBoard, newNextNum, newActiveColor, boardSize, [], { x: 0, y: 0, color: activeColor });
    };

    const handleWheel = (delta: number) => {
        if (Math.abs(delta) < 10) return;
        if (delta > 0) stepForward(); else stepBack();
    };

    const handleDragStart = (x: number, y: number) => {
        dragStartRef.current = { x, y };

        // Check if clicking inside existing selection
        if (selectionStart && selectionEnd) {
            const x1 = Math.min(selectionStart.x, selectionEnd.x);
            const x2 = Math.max(selectionStart.x, selectionEnd.x);
            const y1 = Math.min(selectionStart.y, selectionEnd.y);
            const y2 = Math.max(selectionStart.y, selectionEnd.y);

            if (x >= x1 && x <= x2 && y >= y1 && y <= y2) {
                setDragMode('MOVING_SELECTION');
                setMoveSource({ x, y });
                setOriginalSelection({ start: selectionStart, end: selectionEnd });
                setIsSelecting(true);
                return;
            }
        }

        const stone = board[y - 1][x - 1];
        if (stone) {
            setDragMode('MOVING_STONE');
            setMoveSource({ x, y });
            setSelectionStart({ x, y });
            setSelectionEnd({ x, y });
        } else {
            setDragMode('SELECTING');
            setSelectionStart({ x, y });
            setSelectionEnd({ x, y });
        }
        setIsSelecting(true);
    };

    const handleDragMove = (x: number, y: number) => {
        if (!isSelecting) return;

        if (dragMode === 'MOVING_SELECTION' && moveSource && originalSelection) {
            const dx = x - moveSource.x;
            const dy = y - moveSource.y;
            // Update selection position
            setSelectionStart({
                x: originalSelection.start.x + dx,
                y: originalSelection.start.y + dy
            });
            setSelectionEnd({
                x: originalSelection.end.x + dx,
                y: originalSelection.end.y + dy
            });
        } else {
            setSelectionEnd({ x, y });
        }
    };

    const handleDragEnd = () => {
        setIsSelecting(false);
        if (!selectionStart || !selectionEnd) return;

        if (dragMode === 'MOVING_SELECTION' && moveSource && originalSelection) {
            const dx = selectionStart.x - originalSelection.start.x;
            const dy = selectionStart.y - originalSelection.start.y;

            if (dx !== 0 || dy !== 0) {
                // Calculate original bounds
                const ox1 = Math.min(originalSelection.start.x, originalSelection.end.x);
                const ox2 = Math.max(originalSelection.start.x, originalSelection.end.x);
                const oy1 = Math.min(originalSelection.start.y, originalSelection.end.y);
                const oy2 = Math.max(originalSelection.start.y, originalSelection.end.y);

                const newBoard = board.map(row => [...row]);
                const stonesToMove: { stone: Stone, x: number, y: number }[] = [];

                // Collect and remove from source
                for (let y = oy1; y <= oy2; y++) {
                    for (let x = ox1; x <= ox2; x++) {
                        if (y >= 1 && y <= boardSize && x >= 1 && x <= boardSize) {
                            const s = newBoard[y - 1][x - 1];
                            if (s) {
                                stonesToMove.push({ stone: s, x, y });
                                newBoard[y - 1][x - 1] = null;
                            }
                        }
                    }
                }

                // Place in target
                stonesToMove.forEach(({ stone, x, y }) => {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 1 && nx <= boardSize && ny >= 1 && ny <= boardSize) {
                        newBoard[ny - 1][nx - 1] = stone;
                    }
                });

                commitState(newBoard, nextNumber, activeColor, boardSize);
            }

            setMoveSource(null);
            setOriginalSelection(null);
            setTimeout(() => { dragStartRef.current = null; }, 0);
            return;
        }

        if (dragMode === 'MOVING_STONE' && moveSource) {
            const targetX = selectionEnd.x;
            const targetY = selectionEnd.y;
            if ((moveSource.x !== targetX || moveSource.y !== targetY) && !board[targetY - 1][targetX - 1]) {
                if (mode === 'SIMPLE') {
                    // Simple Mode: Move setup stone on Root
                    modifyRootBoard((b) => {
                        const sourceCell = b[moveSource.y - 1][moveSource.x - 1];
                        // Only move if source has a setup stone (no number) and target is empty
                        if (sourceCell && !sourceCell.number && !b[targetY - 1][targetX - 1]) {
                            b[targetY - 1][targetX - 1] = sourceCell;
                            b[moveSource.y - 1][moveSource.x - 1] = null;
                        }
                    });
                } else {
                    // Numbered Mode
                    const stone = board[moveSource.y - 1][moveSource.x - 1];

                    // Case A: Correcting the LAST move (Undo + Replay at new spot)
                    // We rewrite the CURRENT history step instead of appending.
                    if (stone && stone.number === nextNumber - 1 && currentMoveIndex > 0) {
                        const parent = currentState.parent;
                        if (parent) {
                            const parentBoard = parent.board.map((r: (Stone | null)[]) => r.map((c: Stone | null) => c ? { ...c } : null));

                            // Place at new Target
                            if (targetX >= 1 && targetX <= boardSize && targetY >= 1 && targetY <= boardSize) {
                                parentBoard[targetY - 1][targetX - 1] = { color: stone.color, number: stone.number };

                                // Check Captures on the base board context
                                const captured = checkCaptures(parentBoard, targetX - 1, targetY - 1, stone.color);
                                captured.forEach(c => parentBoard[c.y][c.x] = null);

                                const newNode = addMove(
                                    parent,
                                    parentBoard,
                                    nextNumber, // Preserved nextNumber (N+1)
                                    activeColor, // Preserved activeColor
                                    boardSize,
                                    { x: targetX, y: targetY, color: stone.color }
                                );
                                setCurrentNodeId(newNode.id);
                            }
                        }
                    }
                    // Case B: Moving an older stone (Append Correction Step)
                    else if (stone) {
                        const newBoard = board.map((row: (Stone | null)[]) => [...row]);
                        newBoard[moveSource.y - 1][moveSource.x - 1] = null;
                        newBoard[targetY - 1][targetX - 1] = stone;
                        const captured = checkCaptures(newBoard, targetX - 1, targetY - 1, stone.color);
                        captured.forEach(c => newBoard[c.y][c.x] = null);
                        commitState(newBoard, nextNumber, activeColor, boardSize);
                    }
                }
            }
            setSelectionStart(null);
            setSelectionEnd(null);
        }
        setMoveSource(null);
        setTimeout(() => { dragStartRef.current = null; }, 0);
    };

    const handleDeleteParams = () => {
        if (hoveredCellRef.current) {
            const { x, y } = hoveredCellRef.current;
            if (board[y - 1][x - 1]) {
                const newBoard = board.map((row: (Stone | null)[]) => [...row]);
                newBoard[y - 1][x - 1] = null;
                commitState(newBoard, nextNumber, activeColor, boardSize);
                return true;
            }
        }
        if (selectionStart && selectionEnd) {
            const x1 = Math.min(selectionStart.x, selectionEnd.x);
            const x2 = Math.max(selectionStart.x, selectionEnd.x);
            const y1 = Math.min(selectionStart.y, selectionEnd.y);
            const y2 = Math.max(selectionStart.y, selectionEnd.y);
            const newBoard = board.map((row: (Stone | null)[]) => [...row]);
            let changed = false;
            for (let iy = y1; iy <= y2; iy++) {
                for (let ix = x1; ix <= x2; ix++) {
                    if (newBoard[iy - 1][ix - 1]) {
                        newBoard[iy - 1][ix - 1] = null;
                        changed = true;
                    }
                }
            }
            if (changed) {
                commitState(newBoard, nextNumber, activeColor, boardSize);
                return true;
            }
        }
        return false;
    };

    const getBounds = useCallback((searchArea?: { x1: number, y1: number, x2: number, y2: number }) => {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        let hasStones = false;

        const startX = searchArea ? Math.max(1, searchArea.x1) : 1;
        const endX = searchArea ? Math.min(boardSize, searchArea.x2) : boardSize;
        const startY = searchArea ? Math.max(1, searchArea.y1) : 1;
        const endY = searchArea ? Math.min(boardSize, searchArea.y2) : boardSize;

        for (let y = startY; y <= endY; y++) {
            for (let x = startX; x <= endX; x++) {
                if (board[y - 1][x - 1]) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                    hasStones = true;
                }
            }
        }
        return { hasStones, minX, maxX, minY, maxY };
    }, [board, boardSize]);


    // Generate hidden move references and special labels
    // Logic: Identify board locations with multiple moves (collisions).
    // Update v32: Also identifying Manual Labels covering hidden moves.
    // Assign letters A, B, C... to those locations.
    // Footer lists all moves at those locations as "MoveNum [ Label ]".
    // Generate hidden move references and special labels
    // Logic: Identify board locations with multiple moves (collisions).
    // Identify Manual Labels covering hidden moves.
    // Assign letters A, B, C... to those locations.
    // Footer lists all moves at those locations as "MoveNum [ Label ]".


    // Display Board Logic: when a cell has multiple stones in its history
    // (collision), draw the *base* (earliest) stone instead of the latest
    // one. Without this the legend references a number that isn't visible
    // anywhere on the board.
    const displayBoard = useMemo<BoardState>(() => {
        if (!board || currentMoveIndex < 0) return board;

        const cellHistory = new Map<string, { number: number; color: StoneColor }[]>();

        // Setup stones — placement number 0
        const initialBoard = history[0]?.board;
        if (initialBoard) {
            for (let y = 0; y < boardSize; y++) {
                for (let x = 0; x < boardSize; x++) {
                    const s = initialBoard[y]?.[x];
                    if (s) {
                        cellHistory.set(`${x},${y}`, [{ number: 0, color: s.color }]);
                    }
                }
            }
        }

        // Diff successive board snapshots to detect placements
        for (let i = 1; i <= currentMoveIndex; i++) {
            const prevBoard = history[i - 1]?.board;
            const currBoard = history[i]?.board;
            if (!prevBoard || !currBoard) continue;
            for (let y = 0; y < boardSize; y++) {
                for (let x = 0; x < boardSize; x++) {
                    const prevStone = prevBoard[y]?.[x];
                    const currStone = currBoard[y]?.[x];
                    if (currStone && (!prevStone || currStone.color !== prevStone.color)) {
                        const key = `${x},${y}`;
                        const list = cellHistory.get(key) ?? [];
                        list.push({ number: currStone.number ?? -1, color: currStone.color });
                        cellHistory.set(key, list);
                    }
                }
            }
        }

        return board.map((row, y) =>
            row.map((stone, x) => {
                const list = cellHistory.get(`${x},${y}`);
                if (!list || list.length < 2) return stone;
                // Earliest numbered (>0) placement is the base.
                const numbered = list.filter(m => m.number > 0).sort((a, b) => a.number - b.number);
                if (numbered.length === 0) return stone;
                const base = numbered[0];
                return { ...(stone ?? {}), color: base.color, number: base.number };
            })
        );
    }, [board, history, currentMoveIndex, boardSize]);

    // Navigation Helpers (Tree Adapted)
    const stepBack = () => {
        if (history.length > 1) {
            setCurrentNodeId(history[history.length - 2].id);
        }
    };
    const stepForward = () => {
        if (currentState.children.length > 0) {
            setCurrentNodeId(currentState.children[0].id);
        }
    };
    const deleteLastMove = () => {
        if (currentState === rootNode) return;
        if (currentState.parent) {
            const parent = currentState.parent;
            const idx = parent.children.indexOf(currentState);
            if (idx >= 0) {
                parent.children.splice(idx, 1);
                setCurrentNodeId(parent.id);
                setRootNode({ ...rootNode });
            }
        }
    };
    const restoreMove = stepForward;
    const stepFirst = () => setCurrentNodeId(rootNode.id);
    const stepLast = () => {
        let node = currentState;
        while (node.children.length > 0) {
            node = node.children[0];
        }
        setCurrentNodeId(node.id);
    };

    // Fast Forward / Rewind: Jump 10 steps or to end/start of current line
    const stepBack10 = () => {
        let targetIndex = Math.max(0, currentMoveIndex - 10);
        if (history[targetIndex]) setCurrentNodeId(history[targetIndex].id);
    };

    // Forward 10 is tricky in a tree (which branch?). We follow the *first* child (main line)
    const stepForward10 = () => {
        let node = currentState;
        for (let i = 0; i < 10; i++) {
            if (node.children.length === 0) break;
            node = node.children[0];
        }
        setCurrentNodeId(node.id);
    };

    // Delete/Restore are less relevant in Tree Mode where we preserve branches.
    // We can just utilize Undo (stepBack).
    // If we want to strictly "Delete" a branch, we would need tree surgery methods.
    // For now, removing the UI buttons or making them no-ops is safer.

    const getRestoredStones = useCallback(() => {
        const restored: { x: number, y: number, color: StoneColor, text: string }[] = [];
        const currentBoard = history[currentMoveIndex].board;
        const size = boardSize;
        const moveHistory = new Map<string, { number: number, color: StoneColor }[]>();

        // 1. Scan History for Numbered Moves
        for (let i = 1; i <= currentMoveIndex; i++) {
            const currBoard = history[i].board;
            const moveNum = history[i - 1].nextNumber;
            // Find move position
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const stone = currBoard[y][x];
                    if (stone && stone.number === moveNum) {
                        const key = `${x},${y}`;
                        if (!moveHistory.has(key)) moveHistory.set(key, []);
                        moveHistory.get(key)?.push({ number: moveNum, color: stone.color });
                    }
                }
            }
        }

        // 2. Identification (Numbered Moves)
        moveHistory.forEach((moves, key) => {
            const [x, y] = key.split(',').map(Number);
            const currentStone = currentBoard[y][x];
            if (!currentStone) {
                const m = moves[0];
                restored.push({
                    x: x + 1, y: y + 1,
                    color: m.color,
                    text: m.number.toString()
                });
            }
        });

        // 3. Scan Base Setup (Simple Mode Stones)
        // If a stone exists in history[0] but is missing in currentBoard, it was captured.
        // (Manual deletion in Simple Mode propagates to history[0], so it wouldn't be there).
        const baseBoard = history[0].board;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const baseStone = baseBoard[y][x];
                const currentStone = currentBoard[y][x];

                // If base stone exists AND current spot is empty
                if (baseStone && !currentStone) {
                    // Check if we already added a restored stone here (from numbered logic)?
                    // Unlikely for setup stone, as it has no number.
                    // But if a numbered move was played and then captured...
                    // The numbered logic adds it.
                    // We should prioritize Numbered restore? or Base restore?
                    // If a Base stone was captured, and THEN a numbered stone was played and captured.
                    // The numbered stone is "later".
                    // But usually we show the *first* stone?
                    // Actually, if Numbered stone was played, the Base stone must have been captured/removed BEFORE that.
                    // So we might have TWO restored stones?
                    // Rendering multiple stones on top of each other?
                    // `performExport` just draws circles.
                    // If we draw Base then Numbered, Numbered covers Base.
                    // Let's check for existing restored entry.
                    const alreadyRestored = restored.some(r => r.x === x + 1 && r.y === y + 1);
                    if (!alreadyRestored) {
                        restored.push({
                            x: x + 1, y: y + 1,
                            color: baseStone.color,
                            text: '' // No number for setup stones
                        });
                    }
                }
            }
        }

        return restored;
    }, [history, currentMoveIndex, boardSize]);

    const appendCapturedStonesForExport = useCallback((
        svgRoot: SVGSVGElement,
        restoredStones: { x: number, y: number, color: StoneColor, text: string }[],
        bounds: { minX: number, maxX: number, minY: number, maxY: number }
    ) => {
        const CELL_SIZE = 40;
        const MARGIN = 40;
        const svgNS = "http://www.w3.org/2000/svg";

        restoredStones.forEach(stone => {
            if (stone.x < bounds.minX || stone.x > bounds.maxX || stone.y < bounds.minY || stone.y > bounds.maxY) return;

            const cx = MARGIN + (stone.x - 1) * CELL_SIZE;
            const cy = MARGIN + (stone.y - 1) * CELL_SIZE;

            const g = document.createElementNS(svgNS, 'g');
            g.setAttribute('opacity', '0.4');

            const circle = document.createElementNS(svgNS, 'circle');
            circle.setAttribute('cx', cx.toString());
            circle.setAttribute('cy', cy.toString());
            circle.setAttribute('r', '18.4');
            circle.setAttribute('fill', stone.color === 'BLACK' ? '#000000' : '#FFFFFF');
            circle.setAttribute('stroke', '#000000');
            circle.setAttribute('stroke-width', stone.color === 'BLACK' ? '2' : '0.7');

            g.appendChild(circle);

            if (showNumbers && stone.text) {
                const text = document.createElementNS(svgNS, 'text');
                text.setAttribute('x', cx.toString());
                text.setAttribute('y', cy.toString());
                text.setAttribute('dy', '.35em');
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('fill', stone.color === 'BLACK' ? '#FFFFFF' : '#000000');
                text.setAttribute('font-size', stone.text.length >= 3 ? '18' : '26');
                text.setAttribute('font-family', 'Arial, sans-serif');
                text.setAttribute('font-weight', 'bold');
                text.textContent = stone.text;
                g.appendChild(text);
            }

            svgRoot.appendChild(g);
        });
    }, [showNumbers]);



    // Kifu Metadata
    const [blackName, setBlackName] = useState('');
    const [blackRank, setBlackRank] = useState('');
    const [blackTeam, setBlackTeam] = useState('');
    const [whiteName, setWhiteName] = useState('');
    const [whiteRank, setWhiteRank] = useState('');
    const [whiteTeam, setWhiteTeam] = useState('');
    const [komi, setKomi] = useState('');
    const [handicap, setHandicap] = useState('');
    const [gameResult, setGameResult] = useState('');
    const [gameDate, setGameDate] = useState('');
    const [gamePlace, setGamePlace] = useState('');
    const [gameEvent, setGameEvent] = useState('');
    const [gameRound, setGameRound] = useState('');
    const [gameTime, setGameTime] = useState('');
    const [gameName, setGameName] = useState(''); // GN
    const [gameUser, setGameUser] = useState('');
    const [gameSource, setGameSource] = useState('');
    const [gameComment, setGameComment] = useState('');
    const [gameCopyright, setGameCopyright] = useState('');
    const [gameAnnotation, setGameAnnotation] = useState('');

    const [showGameInfoModal, setShowGameInfoModal] = useState(false);
    const [showPrintModal, setShowPrintModal] = useState(false);
    const [printSettings, setPrintSettings] = useState<PrintSettings | null>(null);

    // Variable Substitution
    // Variable Substitution
    const formatPrintString = (template: string, pageNum: number = 1) => {
        let s = template;

        // Helper to replace rank numbers (Safe for names)
        const formatRankNumbers = (str: string) => {
            if (!str) return '';
            return str.replace(/(\d+)([dDkK段級])/g, (_, numStr, type) => {
                const n = parseInt(numStr);
                const isDan = /[dD段]/.test(type);
                const unit = isDan ? '段' : '級';

                if (isNaN(n)) return numStr + unit;

                // Kyu: Arabic numerals
                if (!isDan) return numStr + unit;

                // Dan: Kanji numerals
                if (n === 1) return '初' + unit;

                const digits = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
                let kanjiNum = '';

                if (n < 10) {
                    kanjiNum = digits[n];
                } else if (n < 20) {
                    kanjiNum = '十' + (n % 10 === 0 ? '' : digits[n % 10]);
                } else {
                    kanjiNum = numStr; // Fallback
                }
                return kanjiNum + unit;
            });
        };

        // Helper to format rank field (Strip P)
        const formatRankField = (r: string) => {
            if (!r) return '';
            let f = r.replace(/[pP]/g, '');
            return formatRankNumbers(f);
        };

        const bRankFormatted = formatRankField(blackRank);
        const wRankFormatted = formatRankField(whiteRank);

        // Also apply formatting to names in case rank is embedded (e.g. "Name 3d")
        const bNameFormatted = formatRankNumbers(blackName);
        const wNameFormatted = formatRankNumbers(whiteName);

        // Custom Komi formatting logic
        const rawKomiFormatted = (k: string) => {
            if (!k) return '';
            if (k.endsWith('.5')) return k.replace('.5', '目半');
            return k + '目';
        };

        // %KM% -> "コミ6目半" (User request)
        // %KML% -> "コミ：6目半" (Legacy/Label support)

        // Actually, let's look at the default subtitle: `%DT% %PC% %RE%`. No Komi.
        // Title default: `%GN%`.
        // Header default: `%GN% Page %PAGE%`.
        // Users can add `%KM%`.
        // If they add `%KM%`, they expect "6.5" or "6目半"?
        // Request: "Display as 'コミ〇〇目半' (e.g., 6.5 -> 6目半)". 
        // Example: "6.5 -> 6目半" suggests the "コミ" part might be outside?
        // But "Display Komi in the format 'コミ◯◯目半'" says the whole thing.
        // I will stick to: %KM% = "コミ6目半".

        // Calculate Total Moves (Traverse to end of main branch)
        // Calculate Total Moves (Traverse to end of main branch using RootNode)
        // We use rootNode to ensure we engage the Global Main Line moves, as SGF Result usually applies to the main record.
        // If we used history, and user was in a variation, we might calculate variation length.
        // But usually "RE" in header is for the game.
        // Let's stick to Main Line for consistency with "RE".
        let totalMoves = 0;
        let countingNode = rootNode;
        while (countingNode.children && countingNode.children.length > 0) {
            countingNode = countingNode.children[0];
            // Only count if it's a move (has coordinates) or pass (x=0,y=0). Setup nodes might be tricky.
            // In our system, all children of GameNode are moves (created by addMove).
            if (countingNode.move) {
                totalMoves++;
            }
        }

        const formatGameResult = (re: string) => {
            const prefix = totalMoves > 0 ? `${totalMoves}手完 ` : '';
            if (!re) return prefix.trim();

            // Handle SGF standard B+R, W+3.5 etc
            const match = re.match(/^([BW])\+(.+)$/);
            if (match) {
                const winner = match[1] === 'B' ? '黒' : '白';
                let type = match[2];
                if (type === 'R' || type.toLowerCase() === 'resign') type = '中押し';
                else if (type === 'T' || type.toLowerCase() === 'time') type = '時間切れ';
                else if (type === 'F' || type.toLowerCase() === 'forfeit') type = '反則';
                else {
                    // Score
                    if (type === '0.5') {
                        type = '半目';
                    } else if (type.endsWith('.5')) {
                        type = type.replace('.5', '目半');
                    } else if (/^\d+(\.\d+)?$/.test(type)) { // Only append '目' if it's a number
                        type = type + '目';
                    }
                }
                return `${prefix}${winner}${type}勝ち`;
            }

            // Fallback for manual text, just replace X.5 -> X目半 if it looks like a score
            return `${prefix}${re.replace(/(\d+)\.5/g, '$1目半')}`;
        };

        const bRankStr = bRankFormatted ? ` ${bRankFormatted}` : '';
        const wRankStr = wRankFormatted ? ` ${wRankFormatted}` : '';

        s = s.replace(/%GN%/g, gameName || gameEvent || '');
        s = s.replace(/%EV%/g, gameEvent || '');
        s = s.replace(/%DT%/g, gameDate || '');
        s = s.replace(/%PC%/g, gamePlace || '');
        // Use Formatted Names
        s = s.replace(/%PB%/g, bNameFormatted || '黒番');
        s = s.replace(/%PBL%/g, bNameFormatted ? `黒：${bNameFormatted}${bRankStr}` : '黒番');
        s = s.replace(/%BR%/g, bRankFormatted);
        s = s.replace(/%PW%/g, wNameFormatted || '白番');
        s = s.replace(/%PWL%/g, wNameFormatted ? `白：${wNameFormatted}${wRankStr}` : '白番');
        s = s.replace(/%WR%/g, wRankFormatted);
        s = s.replace(/%RE%/g, formatGameResult(gameResult) || '');
        s = s.replace(/%MOVES%/g, totalMoves > 0 ? `${totalMoves}手完` : '');

        // Komi Logic
        if (komi) {
            const val = rawKomiFormatted(komi);
            s = s.replace(/%KM%/g, `コミ${val}`);
            s = s.replace(/%KML%/g, `コミ：${val}`);
        } else {
            s = s.replace(/%KM%/g, '');
            s = s.replace(/%KML%/g, '');
        }

        s = s.replace(/%TM%/g, gameTime || '');
        s = s.replace(/%PAGE%/g, pageNum.toString());
        return s;
    };



    // 写真統合ヘッダー: [黒写真+名前] タイトル [白写真+名前]
    const renderIntegratedHeader = (settings: PrintSettings | null, pageNum: number) => {
        const showPhotos = settings?.showPlayerPhotos && (printBlackPhoto || printWhitePhoto || blackName || whiteName);
        const formatRank = (r: string) => {
            if (!r) return '';
            let f = r.replace(/[pP]/g, '');
            return f.replace(/(\d+)([dD段])/g, (_, numStr: string, type: string) => {
                const n = parseInt(numStr);
                const isDan = /[dD段]/.test(type);
                if (!isDan) return numStr + '級';
                if (n === 1) return '初段';
                const digits = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
                if (n < 10) return digits[n] + '段';
                if (n < 20) return '十' + (n % 10 === 0 ? '' : digits[n % 10]) + '段';
                return numStr + '段';
            }).replace(/(\d+)([kK級])/g, (_, numStr: string) => numStr + '級');
        };

        const PlayerBadge = ({ photo, name, rank, color }: { photo: string | null; name: string; rank: string; color: 'black' | 'white' }) => (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, border: '1px solid #ccc', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: color === 'black' ? '#1a1a1a' : '#f5f5f5' }}>
                    {photo ? (
                        <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                        <div style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: color === 'black' ? '#fff' : '#1a1a1a' }} />
                    )}
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.3, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name || (color === 'black' ? '黒番' : '白番')}</div>
                    {rank && <div style={{ color: '#666', fontSize: 12 }}>{formatRank(rank)}</div>}
                </div>
            </div>
        );

        return (
            <div style={{ width: '100%', marginBottom: 12 }}>
                {showPhotos ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <PlayerBadge photo={printBlackPhoto} name={blackName} rank={blackRank} color="black" />
                        <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
                            {(settings?.showTitle !== false) && (
                                <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.2 }}>{formatPrintString(settings?.title || '%GN%', pageNum)}</div>
                            )}
                            {(settings?.showSubTitle !== false) && (
                                <div style={{ fontSize: 13, color: '#666', lineHeight: 1.2 }}>{formatPrintString(settings?.subTitle || '%DT%', pageNum)}</div>
                            )}
                            {gameResult && (
                                <div style={{ fontSize: 12, color: '#666', lineHeight: 1.2 }}>{formatPrintString('%RE%', pageNum)}</div>
                            )}
                        </div>
                        <PlayerBadge photo={printWhitePhoto} name={whiteName} rank={whiteRank} color="white" />
                    </div>
                ) : (
                    <div style={{ textAlign: 'center' }}>
                        {(settings?.showTitle !== false) && (
                            <h1 className="text-2xl font-bold mb-1">{formatPrintString(settings?.title || '%GN%', pageNum)}</h1>
                        )}
                        {(settings?.showSubTitle !== false) && (
                            <h2 className="text-lg text-gray-600">{formatPrintString(settings?.subTitle || '%DT%', pageNum)}</h2>
                        )}
                    </div>
                )}
                {(settings?.showHeader !== false) && (
                    <div style={{ textAlign: 'right', fontSize: 10, color: '#888', marginTop: 4, borderBottom: '1px solid #ccc', paddingBottom: 2 }}>
                        {formatPrintString(settings?.header || '', pageNum)}
                    </div>
                )}
            </div>
        );
    };

    // Print Job Initialization removed (Moved to handlePrintRequest direct flow)

    const loadSGF = (content: string) => {
        const { board: initialBoard, size, metadata, root: sgfRoot } = parseSGFTree(content);
        setBoardSize(size);

        // Metadata
        if (metadata) {
            setBlackName(metadata.blackName || '');
            setBlackRank(metadata.blackRank || '');
            setBlackTeam(metadata.blackTeam || '');
            setWhiteName(metadata.whiteName || '');
            setWhiteRank(metadata.whiteRank || '');
            setWhiteTeam(metadata.whiteTeam || '');
            setKomi(metadata.komi || '');
            setHandicap(metadata.handicap || '');
            setGameResult(metadata.result || '');
            setGameDate(metadata.date || '');
            setGamePlace(metadata.place || '');
            setGameEvent(metadata.event || '');
            setGameRound(metadata.round || '');
            setGameTime(metadata.time || '');
            setGameName(metadata.gameName || '');
            setGameUser(metadata.user || '');
            setGameSource(metadata.source || '');
            setGameComment(metadata.gameComment || '');
            setGameCopyright(metadata.copyright || '');
            setGameAnnotation(metadata.annotation || '');
        } else {
            setBlackName(''); setBlackRank(''); setBlackTeam('');
            setWhiteName(''); setWhiteRank(''); setWhiteTeam('');
            setKomi(''); setHandicap(''); setGameResult('');
            setGameDate(''); setGamePlace(''); setGameEvent(''); setGameRound(''); setGameTime('');
            setGameName(''); setGameUser(''); setGameSource(''); setGameComment(''); setGameCopyright(''); setGameAnnotation('');
        }

        // Create Root GameNode
        const root = createNode(null, initialBoard, 1, 'BLACK', size);

        // Recursive Builder
        const buildTree = (sgfNode: SgfTreeNode, parentGameNode: import('./utils/treeUtilsV2').GameNode, parentBoard: BoardState, moveNum: number, activeColor: StoneColor) => {
            // Traverse children
            for (const childSgf of sgfNode.children) {
                if (childSgf.move) {
                    const { x, y, color } = childSgf.move;

                    // PASS Check (x=0, y=0)
                    const isPass = (x === 0 && y === 0);

                    // Validate (Allow Pass)
                    if (!isPass && (x < 1 || x > size || y < 1 || y > size)) continue;

                    // Simulate Move
                    const nextBoard = JSON.parse(JSON.stringify(parentBoard));

                    if (!isPass) {
                        nextBoard[y - 1][x - 1] = { color, number: moveNum };
                        const captures = checkCaptures(nextBoard, x - 1, y - 1, color);
                        captures.forEach(c => { nextBoard[c.y][c.x] = null; });
                    }

                    const nextActive = color === 'BLACK' ? 'WHITE' : 'BLACK';
                    const nextNum = moveNum + 1;

                    // Add to Tree
                    const childGameNode = addMove(
                        parentGameNode,
                        nextBoard,
                        nextNum,
                        nextActive,
                        size,
                        childSgf.move
                    );

                    // Add Markers if any
                    if (childSgf.markers) {
                        childGameNode.markers = childSgf.markers as Marker[];
                    }

                    // Recurse
                    buildTree(childSgf, childGameNode, nextBoard, nextNum, nextActive);
                } else {
                    // Node without move (e.g. comment only, or setup changes in middle?)
                    // For now, if it has children, we might need to handle it.
                    // But standard game trees usually have moves.
                    // If it's a pass?
                    // If recursive structure has empty node as branch holder...
                    // We'll skip adding a GameNode but recurse logic?
                    // It complicates `parentGameNode`.
                    // Ideally every SGF node maps to GameNode.
                    // If no move, we can duplicate the state (Pass) or just skip?
                    // Let's assume skip for now unless it breaks structure.
                    buildTree(childSgf, parentGameNode, parentBoard, moveNum, activeColor);
                }
            }
        };

        // Start recursion
        // sgfRoot is the Start Node (Setup). Its children are the first moves.
        buildTree(sgfRoot, root, initialBoard, 1, 'BLACK');

        setRootNode(root);
        setCurrentNodeId(root.id);
    };









    // const { hiddenMoves, specialLabels } = hiddenMovesData;







    /* RESTORED 2 - LOGIC ONLY */
    const moveHistory = new Map<string, { number: number, color: StoneColor }[]>(); // "x,y" -> list of moves

    // 0. Scan Initial Board (Setup Stones)
    // Setup stones are considered "Move 0" for collision detection.
    const initialBoard = history[0].board;
    const initSize = history[0].boardSize;
    if (initialBoard) {
        for (let y = 0; y < initSize; y++) {
            for (let x = 0; x < initSize; x++) {
                const stone = initialBoard[y][x];
                if (stone) {
                    const key = `${x},${y}`;
                    if (!moveHistory.has(key)) moveHistory.set(key, []);
                    moveHistory.get(key)?.push({ number: 0, color: stone.color });
                }
            }
        }
    }

    // 1. Scan History (Diff-based) to populate moveHistory
    for (let i = 1; i <= currentMoveIndex; i++) {
        const prevBoard = history[i - 1]?.board;
        const currBoard = history[i].board;
        const size = history[i].boardSize;

        if (!prevBoard) continue;

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const prevStone = prevBoard[y][x];
                const currStone = currBoard[y][x];

                // Detect Stone Placement (New Stone or Color Change)
                if (currStone && (!prevStone || currStone.color !== prevStone.color)) {
                    const key = `${x},${y}`;
                    if (!moveHistory.has(key)) moveHistory.set(key, []);

                    moveHistory.get(key)?.push({
                        number: currStone.number ?? -1,
                        color: currStone.color
                    });
                }
            }
        }
    }

    const labels: { x: number, y: number, label: string }[] = [];
    let labelIndex = 0;
    const footer: { left: { text: string, color: StoneColor }[], right: { text: string, color?: StoneColor, isLabel?: boolean } }[] = [];
    const stonesToDraw: { x: number, y: number, color: StoneColor, text: string }[] = [];




    const currentMarkers = history[currentMoveIndex].markers || [];
    const manualLabelMap = new Map<string, string>();
    currentMarkers.forEach(m => {
        if (m.type === 'LABEL') {
            manualLabelMap.set(`${m.x - 1},${m.y - 1}`, m.value);
        }
    });

    const getMoveText = (n: number) => {
        if (n > 0) return n.toString();
        if (n === 0) return ""; // Setup stone
        return ""; // Unnumbered
    };

    moveHistory.forEach((moves, key) => {
        const [x, y] = key.split(',').map(Number);
        const manualLabel = manualLabelMap.get(key);

        if (manualLabel) {
            // Manual Label Priority
            moves.forEach(m => {
                footer.push({
                    left: [{ text: getMoveText(m.number), color: m.color }],
                    right: { text: manualLabel, color: m.color, isLabel: true }
                });
            });
        } else {
            // Standard Logic: Handle ALL moves
            const numberedMoves = moves.filter(m => m.number >= 0);
            numberedMoves.sort((a, b) => a.number - b.number);

            // 1. Identify Base Move (Visible on Board)
            if (numberedMoves.length > 0) {
                // Check if Base is a Setup Stone (Number 0)
                const isSetupBase = numberedMoves[0].number === 0;

                // [Hybrid Logic]
                // If collision exists (>1 move) AND base is Setup Stone:
                // We must assign a label (A, B...) to the Setup Stone so we can reference it in Legend.
                if (numberedMoves.length > 1 && isSetupBase) {
                    const label = alphabet[labelIndex % alphabet.length];
                    labelIndex++;

                    // Mark on Board: Draw 'A' on top of the Setup Stone
                    labels.push({ x: x + 1, y: y + 1, label });

                    const baseMove = numberedMoves[0]; // Setup Stone

                    // Handle Later Moves -> Legend
                    const laterMoves = numberedMoves.slice(1);
                    laterMoves.forEach(m => {
                        footer.push({
                            left: [{ text: getMoveText(m.number), color: m.color }],
                            right: {
                                text: label, // Reference by Label 'A'
                                color: baseMove.color,
                                isLabel: true // Treat as Label Text (not stone circle)
                            }
                        });
                    });

                    // Add Base Move to stonesToDraw (The Setup Stone itself)
                    stonesToDraw.push({
                        x: x + 1,
                        y: y + 1,
                        color: baseMove.color,
                        text: label // Set Label Text on the Overlay Stone
                    });

                } else {
                    // Standard Logic (No Setup Collision OR Number-Number Collision)
                    const baseMove = numberedMoves[0]; // Earliest numbered move

                    // ALWAYS add Base Move to stonesToDraw
                    stonesToDraw.push({
                        x: x + 1,
                        y: y + 1,
                        color: baseMove.color,
                        text: getMoveText(baseMove.number)
                    });

                    // 2. Handle Later Moves -> Legend
                    if (numberedMoves.length > 1) {
                        const laterMoves = numberedMoves.slice(1);
                        laterMoves.forEach(m => {
                            footer.push({
                                left: [{ text: getMoveText(m.number), color: m.color }],
                                right: {
                                    text: getMoveText(baseMove.number),
                                    color: baseMove.color,
                                    isLabel: false
                                }
                            });
                        });
                    }
                }
            }
        }
    });

    // Sort footer by move number (of the hidden move)
    footer.sort((a, b) => {
        const valA = parseInt(a.left[0].text) || 0;
        const valB = parseInt(b.left[0].text) || 0;
        return valA - valB;
    });

    // Group footer entries that share the same base (right) — combine their left arrays
    // so collisions on the same point render as [40 50 60 30] instead of [40 30][50 30][60 30]
    const groupedFooter: typeof footer = [];
    const groupMap = new Map<string, typeof footer[number]>();
    footer.forEach(it => {
        const key = `${it.right.text}|${it.right.color ?? ''}|${it.right.isLabel ? '1' : '0'}`;
        const existing = groupMap.get(key);
        if (existing) {
            existing.left.push(...it.left);
        } else {
            const cloned = { left: [...it.left], right: it.right };
            groupMap.set(key, cloned);
            groupedFooter.push(cloned);
        }
    });
    groupedFooter.forEach(g => {
        g.left.sort((a, b) => (parseInt(a.text) || 0) - (parseInt(b.text) || 0));
    });
    groupedFooter.sort((a, b) => {
        const va = parseInt(a.left[0]?.text) || 0;
        const vb = parseInt(b.left[0]?.text) || 0;
        return va - vb;
    });

    const hiddenMoves = groupedFooter;
    const specialLabels = labels;




    const performExport = useCallback(async (bounds: { minX: number, maxX: number, minY: number, maxY: number }, restoredStones: { x: number, y: number, color: StoneColor, text: string }[] = [], options: { mode: 'SVG' | 'PNG' | 'EMF', destination?: 'CLIPBOARD' | 'DOWNLOAD', filename?: string }) => {
        if (!svgRef.current) return;

        const { mode, destination = 'CLIPBOARD', filename } = options;
        const CELL_SIZE = 40;
        const MARGIN = 40;
        const PADDING = 20;

        const { minX, maxX, minY, maxY } = bounds;

        const x = (minX - 1) * CELL_SIZE + (MARGIN - PADDING);
        const y = (minY - 1) * CELL_SIZE + (MARGIN - PADDING);
        let width = (maxX - minX) * CELL_SIZE + PADDING * 2;
        let height = (maxY - minY) * CELL_SIZE + PADDING * 2;

        const clone = svgRef.current.cloneNode(true) as SVGSVGElement;

        // Remove selection overlay
        const overlayById = clone.getElementById('selection-overlay-rect');
        if (overlayById) overlayById.remove();
        const overlaysByClass = clone.querySelectorAll('.selection-overlay');
        overlaysByClass.forEach(o => o.remove());
        const rects = clone.querySelectorAll('rect');
        rects.forEach(r => {
            if (r.getAttribute('fill') === 'rgba(0, 0, 255, 0.2)') r.remove();
        });

        const svgNS = "http://www.w3.org/2000/svg";

        if (showCapturedInExport) {
            appendCapturedStonesForExport(clone, restoredStones, bounds);
        }

        // Draw Special Labels (Collision Markers) on Board
        // This ensures 'A', 'B' etc. appear on top of stones.
        if (showNumbers && specialLabels.length > 0) {
            specialLabels.forEach(sl => {
                if (sl.x < minX || sl.x > maxX || sl.y < minY || sl.y > maxY) return;

                const cx = MARGIN + (sl.x - 1) * CELL_SIZE;
                const cy = MARGIN + (sl.y - 1) * CELL_SIZE;

                const g = document.createElementNS(svgNS, 'g');

                // Optional: Draw a background circle if needed (usually label just sits on top)
                // But to ensure visibility on black stones, we might need white text, or smart coloring.
                // The label logic in GoBoard checks stone color.
                // For simplified export, let's assume standard visibility rules or just draw a box?
                // GoBoard uses: <text ... stroke="white" stroke-width="0.5px" ...>

                const text = document.createElementNS(svgNS, 'text');
                text.setAttribute('x', cx.toString());
                text.setAttribute('y', cy.toString());
                text.setAttribute('dy', '.35em');
                text.setAttribute('text-anchor', 'middle');

                // Determine color based on stone at that position? 
                // We don't easily have 'board' here, but we can guess or use a consistent style.
                // Use a high-contrast style: Black text with white partial outline/glow?
                // Or just Red?
                // Let's match GoBoard style if possible. GoBoard just renders text.
                // Let's use Red for visibility as collision marker, or standard black/white.
                // Ideally we check the stone color.
                // Let's rely on the footer to explain. Ideally on board it acts as a label.

                text.setAttribute('fill', 'blue'); // Distinct color for markers
                text.setAttribute('font-size', '20');
                text.setAttribute('font-weight', 'bold');
                text.setAttribute('font-family', 'Arial, sans-serif');
                text.textContent = sl.label;

                // Add a white halo for visibility on black stones
                text.setAttribute('stroke', '#FEFEFE');
                text.setAttribute('stroke-width', '0.5');

                g.appendChild(text);
                clone.appendChild(g);
            });
        }

        // Handle Footer (Hidden Moves Explanation)
        // const svgNS declared above


        const bgColor = isMonochrome ? '#FEFEFE' : '#DCB35D';

        // ... Existing Footer Logic ...
        if (showNumbers && hiddenMoves.length > 0) {
            // ... existing checks ...

            // 1. Create a "Cover Rect" to hide any board content below maxY
            //    The clone contains the full board. Expanding viewBox reveals hidden rows.
            //    We must cover them with the background color.
            // UNIFIED: Same formula as cropBottomY = center of last row + half cell
            const coverY = MARGIN + (maxY - 1) * CELL_SIZE + (CELL_SIZE / 2);
            const coverHeight = 99999; // INCREASED: Arbitrary large height to cover everything below

            const coverRect = document.createElementNS(svgNS, 'rect');
            coverRect.setAttribute('x', '-9999'); // INCREASED: Cover full width generously
            coverRect.setAttribute('y', coverY.toString());
            coverRect.setAttribute('width', '99999'); // INCREASED: Cover full width generously
            coverRect.setAttribute('height', coverHeight.toString());
            coverRect.setAttribute('fill', bgColor);
            clone.appendChild(coverRect);

            // ... Logic to create/clear footerGroup ...
            console.log("Exporting Legend: hiddenMoves count =", hiddenMoves.length);
            let footerGroup = clone.getElementById('footer-group');
            if (!footerGroup) {
                footerGroup = document.createElementNS(svgNS, 'g');
                footerGroup.setAttribute('id', 'footer-group');
                clone.appendChild(footerGroup);
            }


            // Clear existing if any (unlikely)
            while (footerGroup.firstChild) {
                footerGroup.removeChild(footerGroup.firstChild);
            }

            // Relocate Footer to be visible in the cropped view
            const startX = MARGIN + (minX - 1) * CELL_SIZE - CELL_SIZE / 2 + (showCoordinates ? -25 : 0) + 10;

            // UNIFIED CALCULATION: Bottom of the visual crop
            // = Center of last row + half cell = edge of selection padding
            const cropBottomY = MARGIN + (maxY - 1) * CELL_SIZE + (CELL_SIZE / 2);

            // Gap of 40px from the cover line
            const startY = cropBottomY + 40 + (showCoordinates ? 25 : 0);

            footerGroup.setAttribute('transform', `translate(${startX}, ${startY})`);

            // Dynamic Flow Layout Logic for Export
            const boardDisplayWidth = (maxX - minX + 1) * CELL_SIZE;

            let cursorX = 0;
            let cursorY = 0;
            let maxRowY = 0;

            hiddenMoves.forEach((item) => {
                // Layout: visStone1 visStone2 ... [ HiddenStone ]
                // Sizes: Stone Ø36.8 (r=18.4).
                // Per-stone advance: 35px (matches inline preview in GoBoard.tsx)

                const visCount = item.left.length;
                // Block width: vis stones (35 each) + bracket open + base stone + bracket close + padding
                const blockWidth = 20 + visCount * 35 + 5 + 41.8 + 10 + 10;

                // Wrap Check
                if (cursorX + blockWidth > boardDisplayWidth && cursorX > 0) {
                    cursorX = 0;
                    cursorY += 55; // Row Height
                }

                // Create Group for this item
                const itemG = document.createElementNS(svgNS, 'g');
                itemG.setAttribute('transform', `translate(${cursorX}, ${cursorY})`);

                // Advance cursor for next item
                cursorX += blockWidth;

                let drawX = 20; // Start X in group

                // 1. Visible Stones (Left) — render all collision moves at this point
                item.left.forEach((visStone) => {
                    const c = document.createElementNS(svgNS, 'circle');
                    c.setAttribute('cx', drawX.toString());
                    c.setAttribute('cy', '0');
                    c.setAttribute('r', '18.4');
                    c.setAttribute('fill', visStone.color === 'BLACK' ? '#000000' : '#FFFFFF');
                    c.setAttribute('stroke', '#000000');
                    c.setAttribute('stroke-width', visStone.color === 'BLACK' ? '2' : '0.7');
                    itemG.appendChild(c);

                    const t = document.createElementNS(svgNS, 'text');
                    t.setAttribute('x', drawX.toString());
                    t.setAttribute('y', '0');
                    t.setAttribute('dy', '.35em');
                    t.setAttribute('text-anchor', 'middle');
                    t.setAttribute('fill', visStone.color === 'BLACK' ? '#FFFFFF' : '#000000');
                    const fs = (visStone.text && visStone.text.length >= 3) ? '18' : '26';
                    t.setAttribute('font-size', fs);
                    t.setAttribute('font-family', 'Arial, sans-serif');
                    t.setAttribute('font-weight', 'bold');
                    t.textContent = visStone.text;
                    itemG.appendChild(t);

                    drawX += 35; // Advance past stone
                });

                // 2. Open Bracket
                const openB = document.createElementNS(svgNS, 'text');
                openB.setAttribute('x', drawX.toString());
                openB.setAttribute('y', '0');
                openB.setAttribute('dy', '.35em');
                openB.setAttribute('text-anchor', 'middle');
                openB.setAttribute('fill', '#000000');
                openB.setAttribute('font-size', '24');
                openB.setAttribute('font-weight', 'bold');
                openB.textContent = "[";
                itemG.appendChild(openB);

                drawX += 5; // 括弧の直後に進む

                // 3. Hidden Stone (Right)
                // Right part of hiddenMoves is { text, color, isLabel }
                const hidStone = item.right;
                if (hidStone) {
                    // Check if it's a label (text only) or a stone
                    // The goal image implies it's a stone if it has a number/color.

                    if (hidStone.isLabel && !hidStone.color) {
                        // Fallback for純粋 text labels if color missing?
                        // But our logic assigns color usually.
                        const t = document.createElementNS(svgNS, 'text');
                        t.setAttribute('x', drawX.toString());
                        t.setAttribute('y', '0');
                        t.setAttribute('dy', '.35em');
                        t.setAttribute('alignment-baseline', 'middle');
                        t.setAttribute('text-anchor', 'middle');
                        t.setAttribute('font-size', '24');
                        t.textContent = hidStone.text;
                        itemG.appendChild(t);
                    } else {
                        // Draw Hidden Stone
                        // 石の中心を括弧内の中央に配置するため、半径分を加算
                        const stoneCenterX = drawX + 18.4;

                        const c = document.createElementNS(svgNS, 'circle');
                        c.setAttribute('cx', stoneCenterX.toString());
                        c.setAttribute('cy', '0');
                        c.setAttribute('r', '18.4');
                        c.setAttribute('fill', (hidStone.color === 'BLACK') ? '#000000' : '#FFFFFF');
                        c.setAttribute('stroke', '#000000');
                        c.setAttribute('stroke-width', (hidStone.color === 'BLACK' ? '2' : '0.7'));
                        itemG.appendChild(c);

                        const t = document.createElementNS(svgNS, 'text');
                        t.setAttribute('x', stoneCenterX.toString());
                        t.setAttribute('y', '0');
                        t.setAttribute('dy', '.35em');
                        t.setAttribute('text-anchor', 'middle');
                        t.setAttribute('fill', (hidStone.color === 'BLACK') ? '#FFFFFF' : '#000000');
                        const fs = (hidStone.text && hidStone.text.length >= 3) ? '18' : '26';
                        t.setAttribute('font-size', fs);
                        t.setAttribute('font-family', 'Arial, sans-serif');
                        t.setAttribute('font-weight', 'bold');
                        t.textContent = hidStone.text;
                        itemG.appendChild(t);
                    }
                    drawX += 41.8; // 石の直径(36.8) + 隙間(5)
                }

                // 4. Close Bracket
                const closeB = document.createElementNS(svgNS, 'text');
                closeB.setAttribute('x', drawX.toString());
                closeB.setAttribute('y', '0');
                closeB.setAttribute('dy', '.35em');
                closeB.setAttribute('text-anchor', 'middle');
                closeB.setAttribute('fill', '#000000');
                closeB.setAttribute('font-size', '24');
                closeB.setAttribute('font-weight', 'bold');
                closeB.textContent = "]";
                itemG.appendChild(closeB);

                footerGroup.appendChild(itemG);

                maxRowY = Math.max(maxRowY, cursorY); // Fixed: currentY -> cursorY
            });

            const footerContentHeight = maxRowY + 60; // Increased Buffer

            // Robust Height Calculation
            const currentViewboxBottom = y + height;
            const requiredBottom = startY + footerContentHeight + 10;

            if (requiredBottom > currentViewboxBottom) {
                height = requiredBottom - y;
            }
        }

        // --- OVERLAY: Draw Collision Bases on Board ---
        // Iterate collisionOverlays and draw them on top of the board content
        // coordinates are 1-based board coordinates
        if (showNumbers && stonesToDraw.length > 0) {
            const stoneGroup = document.createElementNS(svgNS, 'g');
            stoneGroup.setAttribute('id', 'collision-overlays');
            clone.appendChild(stoneGroup); // Append to end to be on top

            stonesToDraw.forEach(stone => {
                if (stone.x < minX || stone.x > maxX || stone.y < minY || stone.y > maxY) return;

                const cx = MARGIN + (stone.x - 1) * CELL_SIZE;
                const cy = MARGIN + (stone.y - 1) * CELL_SIZE;

                const c = document.createElementNS(svgNS, 'circle');
                c.setAttribute('cx', cx.toString());
                c.setAttribute('cy', cy.toString());
                c.setAttribute('r', '18.4');
                c.setAttribute('fill', stone.color === 'BLACK' ? '#000000' : '#FFFFFF');
                c.setAttribute('stroke', '#000000');
                c.setAttribute('stroke-width', stone.color === 'BLACK' ? '2' : '0.7');
                stoneGroup.appendChild(c);

                const t = document.createElementNS(svgNS, 'text');
                t.setAttribute('x', cx.toString());
                t.setAttribute('y', cy.toString());
                t.setAttribute('dy', '.35em');
                t.setAttribute('text-anchor', 'middle');
                t.setAttribute('fill', stone.color === 'BLACK' ? '#FFFFFF' : '#000000');
                const fontSize = (stone.text && stone.text.length >= 3) ? '18' : '26';
                t.setAttribute('font-size', fontSize);
                t.setAttribute('font-family', 'Arial, sans-serif');
                t.setAttribute('font-weight', 'bold');
                t.textContent = stone.text;
                stoneGroup.appendChild(t);
            });
        }

        // Adjust for Coordinates (Match GoBoard logic)
        let finalX = x;
        let finalY = y;
        let finalW = width;
        let finalH = height;

        if (showCoordinates) {
            finalX -= 25;
            finalY -= 25;
            finalW += 50;
            finalH += 50;
        }

        // Final Sweep: Move board markers to the top so they aren't covered by collision stones or legend background
        const markersInClone = clone.querySelectorAll('.board-marker');
        markersInClone.forEach(m => clone.appendChild(m));

        // No width extension needed as we wrap content.
        clone.setAttribute('viewBox', `${finalX} ${finalY} ${finalW} ${finalH}`);
        clone.setAttribute('width', `${finalW}`);
        clone.setAttribute('height', `${finalH}`);

        if (mode === 'SVG') {
            await exportToSvg(clone, { backgroundColor: bgColor, destination: destination, filename: filename });
        } else if (mode === 'EMF') {
            await exportToEmf(clone, { backgroundColor: bgColor, destination: destination, filename: filename });
        } else {
            await exportToPng(clone, { scale: 3, backgroundColor: bgColor, destination: destination, filename });
        }
    }, [appendCapturedStonesForExport, hiddenMoves, showCoordinates, showCapturedInExport, isMonochrome, specialLabels, boardSize, svgRef, showNumbers]);


    const handleExport = useCallback(async (forcedMode?: 'SVG' | 'PNG', destination?: 'CLIPBOARD' | 'DOWNLOAD') => {
        const modeToUse = forcedMode || exportMode;
        // modeToUse for actual export call

        const filename = ''; // Empty filename as requested

        if (!svgRef.current) return;

        // Forced Full Board Export Logic
        const fullBounds = {
            minX: 1,
            maxX: boardSize,
            minY: 1,
            maxY: boardSize
        };

        // Auto-Enable Figure Mode (Show Label A) for Export
        if (showNumbers) {
            setIsFigureMode(true);
            // Wait for React Render (Important for visual updates like Labels)
            await new Promise(r => setTimeout(r, 100));
        }

        try {
            // MERGE: Captured Stones + Collision Restored Stones (for "Leave 5")
            // Requirement: "If placement is taken, it must not be erased".
            // Therefore, we ALWAYS include restored stones in Export to produce a correct diagram.
            const captured = getRestoredStones();
            const restored = captured;

            await performExport(fullBounds, restored, { mode: modeToUse, destination, filename });
        } catch (err) {
            console.error("Export Error:", err);
            showToast(t('alert.exportError'), 'error');
        } finally {
            if (showNumbers) {
                setIsFigureMode(false);
            }
        }

    }, [boardSize, exportMode, getRestoredStones, performExport, showNumbers]);

    const handleExportGif = useCallback(async () => {
        if (!svgRef.current) return;

        // 1. Pre-Save Flow: First get the file handle to prevent timeout
        let writable: any;
        let handle: any;

        try {
            // @ts-ignore
            if (window.showSaveFilePicker) {
                // @ts-ignore
                handle = await window.showSaveFilePicker({
                    id: 'gorw_gif',
                    types: [{
                        description: 'GIF Animation',
                        accept: { 'image/gif': ['.gif'] },
                    }],
                });
                writable = await handle.createWritable();
            }
        } catch (err) {
            if ((err as Error).name === 'AbortError') return;
            console.warn('File Picker failed, fallback to direct download...', err);
        }

        setIsGifExporting(true);
        setGifProgress(0);

        try {
            const originalNodeId = currentNodeId;
            const originalFigureMode = isFigureMode;
            // GIF is animated — each frame shows moves sequentially, so labels (A,B,C) are unnecessary.
            // Keep isFigureMode false so move numbers are displayed instead of collision labels.
            setIsFigureMode(false);

            // Navigate through all branches (DFS: branch A → rewind → branch B → ...)
            const mainPath = getPathWithBranches(rootNode);
            const frames: string[] = [];

            // Capture frames
            for (let i = 0; i < mainPath.length; i++) {
                flushSync(() => {
                    setCurrentNodeId(mainPath[i].id);
                });
                // Wait for render
                await new Promise(r => setTimeout(r, 100));

                const CELL_SIZE = 40;
                const MARGIN = 40;
                const width = (boardSize) * CELL_SIZE + MARGIN * 2;
                const height = (boardSize) * CELL_SIZE + MARGIN * 2;

                // Export logic using the same approach as exportToPng
                // But we need a data URL for gifshot
                // prepareSvgForExport already clones internally
                const clone = prepareSvgForExport(svgRef.current!, { backgroundColor: isMonochrome ? '#FFFFFF' : '#DCB35C' });

                // Final Sweep for markers in GIF frames
                const markersInClone = clone.querySelectorAll('.board-marker');
                markersInClone.forEach(m => clone.appendChild(m));

                // Add restored stones to clone (same as performExport)
                // ... (simplified for now, ideally reused performExport's logic)

                const pngBlob = await svgToPngBlob(clone, width, height, 2, isMonochrome ? '#FFFFFF' : '#DCB35C');
                const dataUrl = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.readAsDataURL(pngBlob);
                });

                frames.push(dataUrl);
                setGifProgress(Math.round(((i + 1) / mainPath.length) * 100));
            }

            // Generate GIF
            const gifDataUrl = await createGifFromImages(frames, {
                width: 800,
                height: 800,
                interval: playbackSpeed / 1000,
                progressCallback: (p) => {
                    // gifshot progress is 0 to 1
                    setGifProgress(100 + Math.round(p * 100)); // Special range for generation phase
                }
            });

            const gifBlob = await (await fetch(gifDataUrl)).blob();

            if (writable) {
                await writable.write(gifBlob);
                await writable.close();
            } else {
                // Fallback direct download
                const link = document.createElement('a');
                link.href = URL.createObjectURL(gifBlob);
                link.download = 'game.gif';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(link.href);
            }

            // Restore original state
            flushSync(() => {
                setCurrentNodeId(originalNodeId);
            });
            setIsFigureMode(originalFigureMode);

        } catch (err) {
            console.error("GIF Export Error:", err);
            showToast(t('alert.gifFailed'), 'error');
        } finally {
            setIsGifExporting(false);
            setGifProgress(0);
        }
    }, [svgRef, history, rootNode, currentNodeId, boardSize, isMonochrome, playbackSpeed, isFigureMode, getRestoredStones, setCurrentNodeId]);

    const handleExportSelection = useCallback(async () => {
        if (!selectionStart || !selectionEnd) return;

        const x1 = Math.min(selectionStart.x, selectionEnd.x);
        const x2 = Math.max(selectionStart.x, selectionEnd.x);
        const y1 = Math.min(selectionStart.y, selectionEnd.y);
        const y2 = Math.max(selectionStart.y, selectionEnd.y);

        try {
            if (showNumbers) {
                setIsFigureMode(true);
                await new Promise(r => setTimeout(r, 50));
            }
            const captured = getRestoredStones(); // Always included
            const restored = captured;
            await performExport({ minX: x1, maxX: x2, minY: y1, maxY: y2 }, restored, { mode: exportMode });
        } catch (e) {
            console.error(e);
            showToast(t('alert.exportError'), 'error');
        } finally {
            if (showNumbers) {
                setIsFigureMode(false);
            }
        }

        // Reset Selection
        setIsSelecting(false);
        setSelectionStart(null);
        setSelectionEnd(null);
        setDragMode('SELECTING');
        setMoveSource(null);
    }, [selectionStart, selectionEnd, getBounds, getRestoredStones, showCapturedInExport, performExport, exportMode, setIsFigureMode, showNumbers]);



    // State-Driven GIF Export Effect




    // SGF Logic
    const getSGFString = useCallback(() => {
        // historyOverride is ignored/removed for full tree save

        const metadata: import('./utils/sgfUtils').SgfMetadata = {
            gameName, event: gameEvent, date: gameDate, place: gamePlace, round: gameRound,
            blackName, blackRank, blackTeam, whiteName, whiteRank, whiteTeam,
            komi, handicap, result: gameResult, time: gameTime,
            user: gameUser, source: gameSource, gameComment, copyright: gameCopyright, annotation: gameAnnotation
        };

        // Pass rootNode to generator
        // We cast rootNode to any to avoid strict structural recursion mismatch issues if any
        return generateSGFTree(rootNode as any, rootNode.boardSize || boardSize, metadata);

    }, [rootNode, boardSize, gameName, gameEvent, gameDate, gamePlace, gameRound, blackName, blackRank, blackTeam, whiteName, whiteRank, whiteTeam, komi, handicap, gameResult, gameTime, gameUser, gameSource, gameComment, gameCopyright, gameAnnotation]);

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            if (evt.target?.result) {
                loadSGF(evt.target.result as string);
                setSaveFileHandle(null); // No handle from input
            }
        };
        reader.readAsText(file);
        // Reset input
        e.target.value = '';
    };

    const handleOpenSGF = async () => {
        try {
            // @ts-ignore
            if (window.showOpenFilePicker) {
                // @ts-ignore
                const [handle] = await window.showOpenFilePicker({
                    id: 'gorw_sgf',
                    startIn: saveFileHandle || lastDirHandleRef.current || undefined,
                    types: [{
                        description: 'Smart Game Format',
                        accept: { 'application/x-go-sgf': ['.sgf'] },
                    }],
                    multiple: false
                });
                const file = await handle.getFile();
                const text = await file.text();
                loadSGF(text);
                setSaveFileHandle(handle);
            } else {
                fileInputRef.current?.click();
            }
        } catch (err) {
            if ((err as Error).name === 'AbortError') return;
            console.error('Open SGF failed', err);
            showToast(t('alert.openError'), 'error');
        }
    };

    const handlePrintRequest = async (settings: PrintSettings) => {
        // Chrome サイドパネルでは window.print() が無視されるため
        // ユーザージェスチャ内で新規ウィンドウを開き、そこから印刷する
        const printWindow = window.open('', '_blank');

        // 棋士写真を事前取得（非同期）
        let bPhoto: string | null = null;
        let wPhoto: string | null = null;
        if (settings.showPlayerPhotos) {
            [bPhoto, wPhoto] = await Promise.all([
                getPhoto(blackName).catch(() => null),
                getPhoto(whiteName).catch(() => null),
            ]);
        }

        flushSync(() => {
            setPrintBlackPhoto(bPhoto);
            setPrintWhitePhoto(wPhoto);
            setPrintSettings(settings);
            setShowPrintModal(false);
            setIsPrintJob(true);
        });

        setTimeout(() => {
            try {
                const printRoot = document.getElementById('print-root');
                if (!printRoot || !printWindow) {
                    throw new Error('Print resources not available');
                }

                // 現在のページの全CSSルールを収集してインライン化
                const allCSS = Array.from(document.styleSheets)
                    .flatMap(sheet => {
                        try {
                            return Array.from(sheet.cssRules).map(r => r.cssText);
                        } catch {
                            return [];
                        }
                    })
                    .join('\n');

                const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:5mm}\n${allCSS}</style></head><body>${printRoot.innerHTML}</body></html>`;

                printWindow.document.open();
                printWindow.document.write(html);
                printWindow.document.close();

                printWindow.onload = () => {
                    printWindow.print();
                };
            } catch (e) {
                if (printWindow) printWindow.close();
                console.error("Print dialog failed", e);
                showToast(t('alert.printError'), 'error');
            }
            setIsPrintJob(false);
        }, 200);
    };



    const handleSaveSGF = async () => {
        const sgf = getSGFString();
        const blob = new Blob([sgf], { type: 'application/x-go-sgf' });
        const url = URL.createObjectURL(blob);

        // 1) File System Access API (最優先)
        try {
            // @ts-ignore
            if (window.showSaveFilePicker) {
                // @ts-ignore
                const handle = await window.showSaveFilePicker({
                    id: 'gorw_sgf',
                    suggestedName: '',
                    startIn: saveFileHandle || lastDirHandleRef.current || undefined,
                    types: [{
                        description: 'Smart Game Format',
                        accept: { 'application/x-go-sgf': ['.sgf'] },
                    }],
                });
                const writable = await handle.createWritable();
                await writable.write(sgf);
                await writable.close();
                setSaveFileHandle(handle); // Overwrite に使うハンドルを保持
                URL.revokeObjectURL(url);
                return;
            }
        } catch (err) {
            if ((err as Error).name === 'AbortError') {
                URL.revokeObjectURL(url);
                return; // ユーザーキャンセル
            }
            console.warn('Save File Picker failed, try downloads API', err);
        }

        // 2) downloads API で強制的にエクスプローラを開く
        if (typeof chrome !== 'undefined' && chrome?.downloads?.download) {
            try {
                await new Promise<void>((resolve, reject) => {
                    chrome.downloads.download(
                        { url, filename: '', saveAs: true, conflictAction: 'overwrite' },
                        (downloadId: number) => {
                            const lastErr = chrome.runtime?.lastError;
                            if (lastErr) reject(lastErr);
                            else {
                                notifyDownloadLocation(downloadId, (p) => showToast(t('alert.saved', { path: p }), 'success'));
                                resolve();
                            }
                        }
                    );
                });
                URL.revokeObjectURL(url);
                return;
            } catch (err) {
                console.warn('chrome.downloads download failed', err);
            }
        }

        // 3) それでも無理な場合は明示的に知らせる（自動DLは避ける）
        URL.revokeObjectURL(url);
        showToast(t('alert.saveError'), 'error');
    };

    const handleOverwriteSave = async () => {
        if (saveFileHandle) {
            try {
                const sgf = getSGFString();
                const writable = await saveFileHandle.createWritable();
                await writable.write(sgf);
                await writable.close();
                console.log('Overwritten successfully');
                // Optional: Toast?
                return;
            } catch (err) {
                console.error('Overwrite failed', err);
                // If permission lost or file deleted, fallback to Save As
                setSaveFileHandle(null);
                handleSaveSGF();
            }
        }
    };





    const handleZoomToSelection = () => {
        if (selectionStart && selectionEnd) {
            const minX = Math.min(selectionStart.x, selectionEnd.x);
            const maxX = Math.max(selectionStart.x, selectionEnd.x);
            const minY = Math.min(selectionStart.y, selectionEnd.y);
            const maxY = Math.max(selectionStart.y, selectionEnd.y);
            setViewRange({ minX, maxX, minY, maxY });
            // Clear selection after zoom
            setSelectionStart(null);
            setSelectionEnd(null);
        }
    };

    // Prevent default scroll on board
    useEffect(() => {
        const el = svgRef.current;
        if (!el) return;
        const preventScroll = (e: WheelEvent) => {
            e.preventDefault();
        };
        el.addEventListener('wheel', preventScroll, { passive: false });
        return () => el.removeEventListener('wheel', preventScroll);
    }, []);

    useEffect(() => {
        const onPaste = (e: ClipboardEvent) => {
            const text = e.clipboardData?.getData('text');
            if (text && (text.includes('(;') || text.includes('GM['))) {
                e.preventDefault();
                loadSGF(text);
            }
        };
        window.addEventListener('paste', onPaste);
        return () => window.removeEventListener('paste', onPaste);
    }, [history, currentMoveIndex, nextNumber, activeColor]);

    const setNextNumberDirectly = (n: number) => {
        commitState(currentState.board, n, activeColor, boardSize, currentState.markers);
    };

    const doClearBoard = () => {
        const newRoot = createNode(null, Array(boardSize).fill(null).map(() => Array(boardSize).fill(null)), 1, getInitialColor(), boardSize);
        setRootNode(newRoot);
        setCurrentNodeId(newRoot.id);
        setShowClearConfirm(false);
    };

    const clearBoard = (skipConfirm = false) => {
        if (skipConfirm) {
            doClearBoard();
        } else {
            setShowClearConfirm(true);
        }
    };

    const handlePasteSGF = async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text && (text.includes('(;') || text.includes('GM['))) {
                loadSGF(text);
            } else {
                showToast(t('alert.pasteNoSGF'), 'error');
            }
        } catch (err) {
            console.error('Failed to read clipboard', err);
            showToast(t('alert.pasteError'), 'error');
        }
    };

    // Keyboard Shortcuts
    useEffect(() => {
        const onKeyDown = async (e: KeyboardEvent) => {
            // Common Modifiers
            const isCtrl = e.ctrlKey || e.metaKey;

            // Suppress browser defaults for app shortcuts and common conflicting keys
            if (isCtrl) {
                if (['n', 'o', 's', 'f', 'p', 'b'].includes(e.key.toLowerCase())) {
                    e.preventDefault();
                }
            }

            if (e.key === 'Escape') {
                if (showHelp) { setShowHelp(false); return; }
                if (isSelecting || selectionStart) {
                    setIsSelecting(false);
                    setSelectionStart(null);
                    setSelectionEnd(null);
                    setDragMode('SELECTING');
                    setMoveSource(null);
                    return;
                }
                if (isCropped) { setViewRange(null); return; }
            }

            if (e.key === 'Delete') {
                const deleted = handleDeleteParams();
                if (!deleted) {
                    deleteLastMove();
                }
                return;
            }

            if (e.key === 'Backspace') {
                stepBack(); // Backspace as Navigation Back
                return;
            }

            if (e.key === 'ArrowLeft') { stepBack(); return; }
            if (e.key === 'ArrowRight') { stepForward(); return; }

            // Shortcuts
            if (isCtrl) {
                switch (e.key.toLowerCase()) {
                    case 'z': // Ctrl+Z: Undo Action (Delete Last Move)
                        deleteLastMove();
                        break;
                    case 'y': // Ctrl+Y: Redo Action (Restore Move)
                        stepForward();
                        break;
                    // case 'n': // Ctrl+N suppressed above. Use Alt+N for New.
                    case 'o': // Open SGF
                        fileInputRef.current?.click();
                        break;
                    case 's': // Save SGF
                        handleSaveSGF();
                        break;
                    case 'f': // Copy Image
                        e.preventDefault();
                        if (selectionStart && selectionEnd) {
                            handleExportSelection();
                        } else {
                            handleExport();
                        }
                        break;
                    case 'c': // Ctrl+C: Copy SGF
                        // If user is selecting text (e.g. in inputs), don't override
                        if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

                        // Check for text selection
                        const sel = window.getSelection();
                        if (sel && sel.toString().length > 0) return;

                        e.preventDefault();

                        const sgf = getSGFString();
                        try {
                            await navigator.clipboard.writeText(sgf);
                            showToast(t('alert.copiedToClipboard'), 'success');
                        } catch (err) {
                            console.error('Failed to copy SGF', err);
                            showToast(t('alert.clipboardError'), 'error');
                        }
                        break;
                    case 'p': // Ctrl+P
                        if (e.ctrlKey || e.metaKey) {
                            e.preventDefault();
                            setShowPrintModal(true);
                        }
                        break;
                    // Ctrl+V is handled by 'paste' event listener
                }
            }

            // Check for Alt+N (New)
            if (e.altKey && e.key.toLowerCase() === 'n') {
                e.preventDefault();
                clearBoard();
            }
        };
        // Use capture phase for better override chance
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [
        board, boardSize, history, currentMoveIndex,
        showHelp, isSelecting, selectionStart, selectionEnd, isCropped,
        handleExportSelection, handleExport, handleSaveSGF, clearBoard, handleDeleteParams, deleteLastMove
    ]);











    // --- Drag & Drop Implementation ---
    const [isDragging, setIsDragging] = useState(false);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // Allow dropping if Files OR Text (SGF)
        if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('text/plain')) {
            setIsDragging(true);
            e.dataTransfer.dropEffect = 'copy';
        }
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // Only reset if leaving the window/container
        // Check relatedTarget to avoid flickering when moving over child elements
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            const file = files[0];
            // Simple check for extension or rely on user knowing it's SGF
            if (file.name.toLowerCase().endsWith('.sgf') || file.name.toLowerCase().endsWith('.txt')) { // Allow txt too for convenience
                const reader = new FileReader();
                reader.onload = (event) => {
                    const content = event.target?.result;
                    if (typeof content === 'string') {
                        loadSGF(content);
                    }
                };
                reader.readAsText(file);
            } else {
                showToast(t('alert.sgfOnly'), 'error');
            }
        } else {
            // Check for Text Content (Drag selection from web/editor)
            const text = e.dataTransfer.getData('text');
            if (text && (text.includes('(;') || text.includes('GM['))) {
                loadSGF(text);
            }
        }
    }, [loadSGF]);


    // Branch Candidates
    const branchCandidates = useMemo(() => {
        // We return an array that satisfies both the "Menu Bar" (needs value/label) 
        // and "GoBoard" (needs x, y, color, id) requirements.
        const candidates: any[] = [];

        // Use currentState for consistency with tree logic
        if (!currentState || !currentState.children || currentState.children.length === 0) return candidates;

        currentState.children.forEach((child, idx) => {
            if (child.move) {
                const label = String.fromCharCode(65 + idx); // A, B, C...
                candidates.push({
                    x: child.move.x,
                    y: child.move.y,
                    type: 'LABEL',
                    value: label,
                    color: child.move.color,
                    id: child.id
                });
            }
        });
        return candidates;
    }, [currentState]);

    const handleBranchClick = (nodeId: string) => {
        setCurrentNodeId(nodeId);
    };

    return (
        <>
            <div
                className={`p-2 sm:p-4 bg-gray-100 min-h-screen flex flex-col items-center font-sans text-sm pb-20 select-none relative ${isDragging ? 'bg-blue-50 outline outline-4 outline-blue-400 outline-offset-[-4px]' : ''} print:hidden`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                {/* Overlay for "Drop File Here" visual feedback */}
                {isDragging && (
                    <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-blue-100 bg-opacity-50">
                        <div className="text-4xl font-bold text-blue-600 bg-white p-8 rounded-xl shadow-lg border-4 border-blue-400">
                            {t('ui.dropFileHere')}
                        </div>
                    </div>
                )}

                {/* Recording Indicator (Non-blocking) */}


                {/* Print Area Removed (Moved Outside) */}
                <div className="flex justify-between w-full items-center mb-2">
                    <div className="flex items-baseline gap-2" title={isDevMode ? `Public: v${APP_VERSION}` : `Internal: ${DEV_VERSION}`}>
                        {displayVersion}
                    </div>
                    <div className="flex gap-2 items-center">

                        {/* Hidden Input for Open SGF */}
                        <input
                            type="file"
                            accept=".sgf"
                            className="hidden"
                            ref={fileInputRef}
                            aria-label="Upload SGF"
                            onChange={handleFileInputChange}
                        />


                        {/* Group 1: File Operations */}
                        <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
                            <button onClick={() => clearBoard()} title={t('tooltip.new')} aria-label={t('tooltip.new')} className="w-8 h-8 rounded-md bg-white hover:bg-red-50 text-red-600 flex items-center justify-center transition-all shadow-sm text-base">
                                🗑️
                            </button>
                            <button onClick={handleOpenSGF} title={t('tooltip.open')} aria-label={t('tooltip.open')} className="w-8 h-8 rounded-md bg-white hover:bg-blue-50 text-blue-600 flex items-center justify-center transition-all shadow-sm text-base">
                                📂
                            </button>
                            <button onClick={handleOverwriteSave} title={t('tooltip.save')} aria-label={t('tooltip.save')} className="w-8 h-8 rounded-md bg-white hover:bg-green-50 text-green-700 flex items-center justify-center transition-all shadow-sm text-base">
                                💾
                            </button>
                            <button onClick={handleSaveSGF} title={t('tooltip.saveAs')} aria-label={t('tooltip.saveAs')} className="w-8 h-8 rounded-md bg-white hover:bg-orange-50 text-orange-600 flex items-center justify-center transition-all shadow-sm">
                                <img src="/icons/save_as_v2.png" alt="Save As" className="w-5 h-5 object-contain opacity-80" />
                            </button>
                            <button onClick={handlePasteSGF} title={t('tooltip.paste')} aria-label={t('tooltip.paste')} className="w-8 h-8 rounded-md bg-white hover:bg-blue-50 text-blue-600 flex items-center justify-center transition-all shadow-sm text-base">
                                📋
                            </button>
                            <button
                                onClick={() => setShowGameInfoModal(true)}
                                className="w-8 h-8 rounded-md bg-blue-500 text-white hover:bg-blue-600 flex items-center justify-center transition-all shadow-sm text-base"
                                title={t('tooltip.gameInfo')} aria-label={t('tooltip.gameInfo')}
                            >
                                ℹ️
                            </button>
                        </div>

                        {/* Group 2: Edit (Undo/Redo) - REMOVED as per request to move to bottom (where it already exists) */}

                        {/* Group 3: View & Tools */}
                        <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
                            <button
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setShowPrintModal(true);
                                }}
                                className="w-8 h-8 rounded-md bg-white hover:bg-gray-50 text-gray-600 flex items-center justify-center transition-all shadow-sm text-base"
                                title={t('tooltip.print')} aria-label={t('tooltip.print')}
                            >
                                🖨️
                            </button>
                            <button
                                onClick={() => setShowCapturedInExport(!showCapturedInExport)}
                                title={t('tooltip.showCaptured', { status: showCapturedInExport ? t('ui.on') : t('ui.off') })} aria-label={t('tooltip.showCaptured', { status: showCapturedInExport ? t('ui.on') : t('ui.off') })}
                                className={`w-8 h-8 rounded-md flex items-center justify-center transition-all shadow-sm text-base ${showCapturedInExport ? 'bg-purple-100 text-purple-700 ring-1 ring-purple-300' : 'bg-white text-gray-400 hover:text-purple-500'}`}
                            >
                                👻
                            </button>
                            <button
                                onClick={() => setShowNextMove(!showNextMove)}
                                title={t('tooltip.showNextMove', { status: showNextMove ? t('ui.on') : t('ui.off') })} aria-label={t('tooltip.showNextMove', { status: showNextMove ? t('ui.on') : t('ui.off') })}
                                className={`w-8 h-8 rounded-md flex items-center justify-center transition-all shadow-sm text-base ${showNextMove ? 'bg-green-100 text-green-700 ring-1 ring-green-300' : 'bg-white text-gray-400 hover:text-green-500'}`}
                            >
                                👁️
                            </button>
                            <button
                                onClick={() => setShowNumbers(!showNumbers)}
                                title={t('tooltip.showNumbers', { status: showNumbers ? t('ui.on') : t('ui.off') })} aria-label={t('tooltip.showNumbers', { status: showNumbers ? t('ui.on') : t('ui.off') })}
                                className={`w-8 h-8 rounded-md flex items-center justify-center transition-all shadow-sm text-base ${showNumbers ? 'bg-cyan-100 text-cyan-700 ring-1 ring-cyan-300' : 'bg-white text-gray-400 hover:text-cyan-500'}`}
                            >
                                ⑨
                            </button>
                            <button onClick={handlePass} disabled={mode !== 'NUMBERED'} title={t('tooltip.pass')} aria-label={t('tooltip.pass')}
                                className="w-8 h-8 rounded-md bg-gray-200 hover:bg-gray-300 disabled:opacity-50 flex items-center justify-center shadow-sm text-gray-700 text-base">
                                ✋
                            </button>
                        </div>

                        {/* Group 4: Export */}
                        <div className="flex bg-indigo-50 rounded-lg items-center px-0.5 py-0.5 border border-indigo-100 gap-0.5">
                            <button onClick={() => { if (selectionStart && selectionEnd) handleExportSelection(); else handleExport(); }}
                                title={t('tooltip.copyAs', { format: exportMode })} aria-label={t('tooltip.copyAs', { format: exportMode })} className="w-8 h-8 rounded-md bg-white text-indigo-600 hover:bg-indigo-50 flex items-center justify-center transition-all shadow-sm text-base">
                                📷
                            </button>
                            <button
                                onClick={() => handleExport('PNG', 'DOWNLOAD')}
                                title={t('tooltip.savePng')} aria-label={t('tooltip.savePng')}
                                className="w-8 h-8 rounded-md bg-white text-indigo-600 hover:bg-indigo-50 flex items-center justify-center transition-all shadow-sm text-base"
                            >
                                ⬇️
                            </button>
                            <button
                                onClick={handleExportGif}
                                disabled={isGifExporting}
                                title={t('tooltip.exportGif')} aria-label={t('tooltip.exportGif')}
                                className="w-8 h-8 rounded-md bg-white text-indigo-600 hover:bg-indigo-50 flex items-center justify-center transition-all shadow-sm disabled:opacity-50 relative overflow-hidden text-base"
                            >
                                {isGifExporting ? (
                                    <span className="text-[10px] font-sans">{gifProgress > 100 ? gifProgress - 100 : gifProgress}%</span>
                                ) : '🎬'}
                            </button>
                            <button
                                title={t('tooltip.toggleFormat')} aria-label={t('tooltip.toggleFormat')}
                                onClick={() => {
                                    const next = exportMode === 'SVG' ? 'PNG' : (exportMode === 'PNG' ? 'EMF' : 'SVG');
                                    setExportMode(next);
                                    localStorage.setItem('gorw_export_mode', next);
                                }}
                                className="w-8 h-8 text-xs font-bold rounded-md bg-white border shadow-sm text-gray-600 hover:text-blue-600 flex items-center justify-center"
                            >
                                {exportMode}
                            </button>
                        </div>

                        {/* Group 5: System */}
                        <div className="flex items-center gap-1 pl-1">
                            {/* Language Switcher */}
                            <button
                                onClick={() => {
                                    const langs: Language[] = ['ja', 'en', 'zh'];
                                    const nextIdx = (langs.indexOf(language) + 1) % langs.length;
                                    setLanguage(langs[nextIdx]);
                                }}
                                className="h-8 px-2 rounded-md bg-gray-100 text-gray-600 hover:bg-blue-100 hover:text-blue-600 flex items-center justify-center font-bold text-xs transition-all border border-gray-200"
                                title={`Language: ${languageNames[language]}`}
                            >
                                {language.toUpperCase()}
                            </button>
                            <button
                                onClick={() => window.open('index.html', '_blank')}
                                className="w-8 h-8 rounded-md bg-gray-100 text-gray-500 hover:bg-gray-200 flex items-center justify-center font-bold text-sm transition-all"
                                title={t('tooltip.openNewTab')} aria-label={t('tooltip.openNewTab')}
                            >
                                ↗
                            </button>
                            <button
                                onClick={() => setShowHelp(true)}
                                className="w-8 h-8 rounded-md bg-gray-100 text-gray-500 hover:bg-gray-200 flex items-center justify-center font-bold text-sm transition-all"
                                title={t('tooltip.help')} aria-label={t('tooltip.help')}
                            >
                                ?
                            </button>
                        </div>
                    </div>
                </div>

                {/* Help Modal */}
                {showHelp && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setShowHelp(false)}>
                        <div className="bg-white rounded-lg shadow-xl p-4 sm:p-6 max-w-sm w-full relative max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                            <button
                                className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 font-bold text-lg"
                                onClick={() => setShowHelp(false)}
                            >
                                ×
                            </button>
                            <h2 className="text-lg font-bold mb-4 text-gray-800 border-b pb-2">{t('help.title')}</h2>
                            <div className="space-y-3 text-sm text-gray-700">
                                <div className="flex items-center gap-3">
                                    <div className="w-6 text-center text-xl">🖱️</div>
                                    <div>
                                        <div className="font-bold">{t('help.clickRightClick')}</div>
                                        <div className="text-xs text-gray-500">{t('help.clickDesc')}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="w-6 text-center text-xl">✋</div>
                                    <div>
                                        <div className="font-bold">{t('help.drag')}</div>
                                        <div className="text-xs text-gray-500">{t('help.dragDesc')}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="w-6 text-center text-xl">⚙️</div>
                                    <div>
                                        <div className="font-bold">{t('help.wheel')}</div>
                                        <div className="text-xs text-gray-500">{t('help.wheelDesc')}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="w-6 text-center text-xs font-mono border rounded bg-gray-100">Ctrl+F</div>
                                    <div>
                                        <div className="font-bold">{t('help.copy')}</div>
                                        <div className="text-xs text-gray-500">{t('help.copyDesc')}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="w-6 text-center text-xs font-mono border rounded bg-gray-100">Ctrl+V</div>
                                    <div>
                                        <div className="font-bold">{t('help.sgfPaste')}</div>
                                        <div className="text-xs text-gray-500">{t('help.sgfPasteDesc')}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="w-6 text-center text-xl">🔢</div>
                                    <div>
                                        <div className="font-bold">{t('help.modeSwitch')}</div>
                                        <div className="text-xs text-gray-500">{t('help.modeSwitchDesc')}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="w-6 text-center text-xl">💾</div>
                                    <div>
                                        <div className="font-bold">{t('help.fileOps')}</div>
                                        <div className="text-xs text-gray-500">{t('help.fileOpsDesc')}</div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="w-6 text-center text-xl">🖨️</div>
                                    <div>
                                        <div className="font-bold">{t('help.printExport')}</div>
                                        <div className="text-xs text-gray-500">{t('help.printExportDesc')}</div>
                                    </div>
                                </div>
                            </div>
                            {/* Keyboard Shortcuts Section */}
                            <div className="mt-4 pt-3 border-t border-gray-200">
                                <h3 className="text-sm font-bold text-gray-700 mb-2">{t('help.shortcuts')}</h3>
                                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                                    {([
                                        ['Alt+N', t('help.shortcutNew')],
                                        ['Ctrl+O', t('help.shortcutOpen')],
                                        ['Ctrl+S', t('help.shortcutSave')],
                                        ['Ctrl+C', t('help.shortcutCopySgf')],
                                        ['Ctrl+F', t('help.shortcutCopyImg')],
                                        ['Ctrl+V', t('help.shortcutPaste')],
                                        ['Ctrl+P', t('help.shortcutPrint')],
                                        ['Ctrl+Z', t('help.shortcutUndo')],
                                        ['Ctrl+Y', t('help.shortcutRedo')],
                                        ['← / →', t('help.shortcutNav')],
                                        ['Delete', t('help.shortcutDelete')],
                                    ] as const).flatMap(([key, desc], i) => [
                                        <span key={`k${i}`} className="font-mono bg-gray-100 border rounded px-1 text-center text-gray-600">{key}</span>,
                                        <span key={`d${i}`} className="text-gray-600">{desc}</span>,
                                    ])}
                                </div>
                            </div>
                            <div className="mt-4 pt-3 border-t border-gray-200">
                                <div className="text-xs text-gray-500 text-center">
                                    <div>{t('about.author')}</div>
                                    <div className="flex justify-center gap-3 mt-1">
                                        <a href="https://mimurago.jp" target="_blank" rel="noopener noreferrer" className="hover:text-blue-500">🌐 {t('about.blog')}</a>
                                        <a href="https://www.youtube.com/@mimurago" target="_blank" rel="noopener noreferrer" className="hover:text-blue-500">📺 {t('about.youtube')}</a>
                                        <a href="https://ichikawakids.com" target="_blank" rel="noopener noreferrer" className="hover:text-blue-500">🏠 {t('about.dojo')}</a>
                                    </div>
                                </div>
                            </div>
                            <div className="mt-3 text-center text-xs text-gray-400">
                                Snap Goban {displayVersion}
                            </div>
                        </div>
                    </div>
                )}

                {/* Clear Confirm Modal */}
                {showClearConfirm && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setShowClearConfirm(false)}>
                        <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full" onClick={e => e.stopPropagation()}>
                            <h2 className="text-lg font-bold mb-2 text-gray-800">{t('confirm.clearTitle')}</h2>
                            <p className="text-sm text-gray-600 mb-6">{t('confirm.clearDesc')}</p>
                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={() => setShowClearConfirm(false)}
                                    className="px-4 py-2 text-sm rounded-md border border-gray-300 hover:bg-gray-100 transition-colors"
                                >
                                    {t('btn.cancel')}
                                </button>
                                <button
                                    onClick={doClearBoard}
                                    className="px-4 py-2 text-sm rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors"
                                >
                                    {t('btn.clearConfirm')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Print Settings Modal */}
                {showPrintModal && (
                    <PrintSettingsModal
                        isOpen={true}
                        onClose={() => setShowPrintModal(false)}
                        onPrint={handlePrintRequest}
                    />
                )}

                {/* Actual Print Content Removed (Moved Outside) */}



                {showGameInfoModal && (
                    <GameInfoModal
                        onClose={() => setShowGameInfoModal(false)}
                        onSave={(data) => {
                            setBlackName(data.blackName);
                            setBlackRank(data.blackRank);
                            setBlackTeam(data.blackTeam);
                            setWhiteName(data.whiteName);
                            setWhiteRank(data.whiteRank);
                            setWhiteTeam(data.whiteTeam);
                            setKomi(data.komi);
                            setHandicap(data.handicap);
                            setGameResult(data.result);
                            setGameName(data.gameName);
                            setGameEvent(data.event);
                            setGameDate(data.date);
                            setGamePlace(data.place);
                            setGameRound(data.round);
                            setGameTime(data.time);
                            setGameUser(data.user);
                            setGameSource(data.source);
                            setGameComment(data.gameComment);
                            setGameCopyright(data.copyright);
                            setGameAnnotation(data.annotation);
                        }}
                        initialData={{
                            blackName, blackRank, blackTeam,
                            whiteName, whiteRank, whiteTeam,
                            komi, handicap, result: gameResult,
                            gameName, event: gameEvent, date: gameDate,
                            place: gamePlace, round: gameRound, time: gameTime,
                            user: gameUser, source: gameSource, gameComment,
                            copyright: gameCopyright, annotation: gameAnnotation,
                        }}
                    />
                )}

                {/* Visual Style Toolbar */}
                <div className="w-full flex justify-end mb-2 gap-2">
                    <button
                        onClick={() => setIsMonochrome(!isMonochrome)}
                        className={`text-xs px-2 py-1 rounded border shadow-sm transition-colors ${isMonochrome
                            ? 'bg-gray-800 text-white border-gray-800'
                            : 'bg-yellow-100 text-yellow-800 border-yellow-300 hover:bg-yellow-200'
                            }`}
                        title={t('tooltip.monochrome')} aria-label={t('tooltip.monochrome')}
                    >
                        {isMonochrome ? t('ui.monochrome') : t('ui.color')}
                    </button>
                </div>

                {/* Board Container */}
                <div
                    className="bg-white shadow-lg p-2 rounded mb-4 w-full"
                    onDoubleClick={handleDoubleClick}
                >
                    <GoBoard
                        ref={svgRef}
                        boardState={displayBoard}
                        boardSize={boardSize}
                        viewRange={effectiveViewRange}
                        showCoordinates={showCoordinates}
                        showNumbers={showNumbers}
                        isMonochrome={isMonochrome}
                        onCellClick={handleInteraction}
                        onCellRightClick={handleRightClick}
                        onBoardWheel={handleWheel}
                        onCellMouseEnter={(x, y) => { hoveredCellRef.current = { x, y }; }}
                        onCellMouseLeave={() => { hoveredCellRef.current = null; }}
                        selectionStart={selectionStart}
                        selectionEnd={selectionEnd}
                        onDragStart={handleDragStart}
                        onDragMove={handleDragMove}
                        onDragEnd={handleDragEnd}
                        specialLabels={specialLabels}
                        hiddenMoves={isFigureMode ? [] : []}
                        prioritizeLabel={isFigureMode}
                        nextNumber={nextNumber}
                        activeColor={activeColor}
                        markers={history[currentMoveIndex]?.markers || []}
                        nextMoves={(branchCandidates.length > 1 || showNextMove) ? branchCandidates : []}
                        onNextMoveClick={handleBranchClick}
                    />

                    {/* Float Controls: Zoom / Reset */}
                    <div className="absolute top-2 right-2 flex gap-2">
                        {/* Zoom / Copy Buttons (only if selected) */}
                        {(selectionStart && selectionEnd) && (
                            <>
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleExportSelection(); }}
                                    className="bg-green-600 text-white text-xs font-bold px-3 py-1 rounded shadow hover:bg-green-700 transition-all flex items-center gap-1"
                                    title={t('tooltip.copySelection')} aria-label={t('tooltip.copySelection')}
                                >
                                    <span>✂️</span> {t('ui.copy')}
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleZoomToSelection(); }}
                                    className="bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded shadow hover:bg-blue-700 transition-all flex items-center gap-1"
                                    title={t('tooltip.cropSelection')} aria-label={t('tooltip.cropSelection')}
                                >
                                    <span>🔍</span> {t('ui.zoom')}
                                </button>
                            </>
                        )}

                        {/* Reset Zoom Button (only if cropped) */}
                        {isCropped && (
                            <button
                                onClick={(e) => { e.stopPropagation(); setViewRange(null); }}
                                className="bg-gray-700 text-white text-xs font-bold px-3 py-1 rounded shadow hover:bg-gray-800 transition-all flex items-center gap-1 opacity-80 hover:opacity-100"
                                title={t('tooltip.resetView')} aria-label={t('tooltip.resetView')}
                            >
                                <span>↺</span> {t('ui.reset')}
                            </button>
                        )}
                    </div>
                </div>

                {/* Controls */}
                <div className="bg-white p-2 sm:p-4 rounded shadow w-full space-y-3 sm:space-y-4">

                    {/* Mode Switch (Compact Icons) & Navigation */}
                    <div className="flex justify-center items-center space-x-1 border-b pb-2 flex-wrap gap-y-1 sm:gap-y-2">
                        {/* Setup Stone: click again to switch black/white */}
                        <button
                            title={activeColor === 'BLACK' ? t('tooltip.placeBlack') : t('tooltip.placeWhite')}
                            aria-label={activeColor === 'BLACK' ? t('tooltip.placeBlack') : t('tooltip.placeWhite')}
                            className={`p-1.5 rounded-full transition-all ${mode === 'SIMPLE' ? 'bg-blue-100 ring-2 ring-blue-500 scale-110' : 'hover:bg-gray-100 opacity-60 hover:opacity-100'}`}
                            onClick={() => {
                                setToolMode('STONE');
                                if (mode === 'SIMPLE') {
                                    const next = activeColor === 'BLACK' ? 'WHITE' : 'BLACK';
                                    currentState.activeColor = next;
                                    setRootNode({ ...rootNode });
                                    try { localStorage.setItem('gorw_active_color', next); } catch (e) { }
                                } else {
                                    setMode('SIMPLE');
                                }
                            }}
                        >
                            <svg width="24" height="24" viewBox="0 0 24 24" className={activeColor === 'BLACK' ? "text-black" : "text-gray-600"}>
                                <circle cx="12" cy="12" r={activeColor === 'BLACK' ? "10" : "9.5"} fill={activeColor === 'BLACK' ? "currentColor" : "white"} stroke={activeColor === 'WHITE' ? "currentColor" : "none"} strokeWidth="1" />
                            </svg>
                        </button>

                        {/* Numbered Stone */}
                        <button
                            title={t('tooltip.numberedMode', { color: activeColor === 'BLACK' ? t('ui.black') : t('ui.white') })} aria-label={t('tooltip.numberedMode', { color: activeColor === 'BLACK' ? t('ui.black') : t('ui.white') })}
                            className={`p-1.5 rounded-full transition-all ${mode === 'NUMBERED' ? 'bg-blue-100 ring-2 ring-blue-500 scale-110' : 'hover:bg-gray-100 opacity-60 hover:opacity-100'}`}
                            onClick={() => {
                                if (mode === 'NUMBERED') {
                                    const next = activeColor === 'BLACK' ? 'WHITE' : 'BLACK';
                                    currentState.activeColor = next;
                                    setRootNode({ ...rootNode });
                                    try { localStorage.setItem('gorw_active_color', next); } catch (e) { }
                                } else {
                                    setMode('NUMBERED');
                                    setToolMode('STONE');
                                    // 前回の色設定はlocalStorageから起動時に復元済み
                                }
                            }}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const next = activeColor === 'BLACK' ? 'WHITE' : 'BLACK';
                                currentState.activeColor = next;
                                setRootNode({ ...rootNode });
                                try { localStorage.setItem('gorw_active_color', next); } catch (e) { }
                            }}
                        >
                            <svg width="24" height="24" viewBox="0 0 24 24" className={activeColor === 'BLACK' ? "text-black" : "text-gray-600"}>
                                <circle cx="12" cy="12" r={activeColor === 'BLACK' ? "10" : "9.5"} fill={activeColor === 'BLACK' ? "currentColor" : "white"} stroke={activeColor === 'WHITE' ? "currentColor" : "none"} strokeWidth="1" />
                                <text x="12" y="17" textAnchor="middle" fill={activeColor === 'BLACK' ? "white" : "black"} fontSize="14" fontWeight="bold" fontFamily="sans-serif">1</text>
                            </svg>
                        </button>

                        {/* Divider */}
                        <div className="w-px h-5 bg-gray-300 mx-1"></div>

                        {/* Combined A / Symbol Tool */}
                        <div className="flex items-center">
                            <button
                                title={t('tooltip.labelMode')} aria-label={t('tooltip.labelMode')}
                                onClick={() => setToolMode('LABEL')}
                                className={`w-8 h-8 font-bold border rounded-l flex items-center justify-center transition-all ${toolMode === 'LABEL' ? 'bg-blue-100 border-blue-500 text-blue-700 z-10' : 'bg-white border-gray-300 hover:bg-gray-100'}`}
                            >
                                A
                            </button>
                            <div className="relative">
                                <select
                                    title={t('tooltip.symbolMode')} aria-label={t('tooltip.symbolMode')}
                                    value={toolMode === 'SYMBOL' ? selectedSymbol : ''}
                                    onChange={(e) => {
                                        const val = e.target.value as SymbolType;
                                        setSelectedSymbol(val);
                                        setToolMode('SYMBOL');
                                    }}
                                    className={`h-8 w-6 border-l-0 rounded-r border px-0 text-sm bg-white cursor-pointer transition-all appearance-none text-center ${toolMode === 'SYMBOL' ? 'border-blue-500 ring-1 ring-blue-500 z-10' : 'border-gray-300 hover:bg-gray-100'}`}
                                >
                                    <option value="" disabled hidden></option>
                                    <option value="TRI">△</option>
                                    <option value="CIR">◯</option>
                                    <option value="SQR">□</option>
                                    <option value="X">✕</option>
                                </select>
                                {/* Arrow Overlay specifically for compact look */}
                                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-gray-500">
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="6 9 12 15 18 9"></polyline>
                                    </svg>
                                </div>
                            </div>
                        </div>


                        {/* Divider */}
                        <div className="w-px h-5 bg-gray-300 mx-1"></div>

                        {/* Navigation Group (Moved here form Top) */}
                        <div className="flex bg-gray-100 rounded p-0.5 gap-0.5 items-center">
                            <button onClick={deleteLastMove} disabled={currentMoveIndex === 0} title={t('tooltip.deleteMove')} aria-label={t('tooltip.deleteMove')}
                                className="w-8 h-8 rounded bg-white hover:bg-red-50 text-red-700 disabled:opacity-50 disabled:bg-gray-50 flex items-center justify-center font-bold text-sm transition-all shadow-sm border border-gray-200 mr-1">
                                ⌫
                            </button>
                            <button onClick={restoreMove} disabled={currentState.children.length === 0} title={t('tooltip.restoreMove')} aria-label={t('tooltip.restoreMove')}
                                className="w-8 h-8 rounded bg-white hover:bg-blue-50 text-blue-700 disabled:opacity-50 disabled:bg-gray-50 flex items-center justify-center font-bold text-sm transition-all shadow-sm border border-gray-200 mr-2">
                                ↻
                            </button>
                            <button onClick={stepFirst} disabled={currentMoveIndex === 0} title={t('tooltip.firstMove')} aria-label={t('tooltip.firstMove')} className="w-8 h-8 rounded bg-white hover:bg-gray-50 text-gray-600 disabled:opacity-50 flex items-center justify-center font-bold text-sm shadow-sm border border-gray-200">
                                |&lt;
                            </button>
                            <button onClick={stepBack10} disabled={currentMoveIndex === 0} title={t('tooltip.back10')} aria-label={t('tooltip.back10')} className="w-8 h-8 rounded bg-white hover:bg-gray-50 text-gray-600 disabled:opacity-50 flex items-center justify-center font-bold text-sm shadow-sm border border-gray-200">
                                &lt;&lt;
                            </button>
                            <button onClick={stepBack} disabled={currentMoveIndex === 0} title={t('tooltip.back')} aria-label={t('tooltip.back')} className="w-8 h-8 rounded bg-white hover:bg-gray-50 text-gray-600 disabled:opacity-50 flex items-center justify-center font-bold text-sm shadow-sm border border-gray-200">
                                &lt;
                            </button>
                            <button onClick={stepForward} disabled={currentState.children.length === 0} title={t('tooltip.forward')} aria-label={t('tooltip.forward')} className="w-8 h-8 rounded bg-white hover:bg-gray-50 text-gray-600 disabled:opacity-50 flex items-center justify-center font-bold text-sm shadow-sm border border-gray-200">
                                &gt;
                            </button>
                            <button onClick={stepForward10} disabled={currentState.children.length === 0} title={t('tooltip.forward10')} aria-label={t('tooltip.forward10')} className="w-8 h-8 rounded bg-white hover:bg-gray-50 text-gray-600 disabled:opacity-50 flex items-center justify-center font-bold text-sm shadow-sm border border-gray-200">
                                &gt;&gt;
                            </button>
                            <button onClick={stepLast} disabled={currentState.children.length === 0} title={t('tooltip.lastMove')} aria-label={t('tooltip.lastMove')} className="w-8 h-8 rounded bg-white hover:bg-gray-50 text-gray-600 disabled:opacity-50 flex items-center justify-center font-bold text-sm shadow-sm border border-gray-200">
                                &gt;|
                            </button>

                            {/* Play/Pause Button */}
                            <button
                                onClick={() => setIsPlaying(!isPlaying)}
                                disabled={currentState.children.length === 0 && !isPlaying}
                                className={`w-8 h-8 rounded flex items-center justify-center font-bold text-sm shadow-sm border transition-all ml-2
                                ${isPlaying
                                        ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                                        : 'bg-green-50 text-green-600 border-green-200 hover:bg-green-100'
                                    } disabled:opacity-50 disabled:bg-gray-50 disabled:text-gray-400`}
                                title={isPlaying ? t('ui.autoPlayStop') : t('ui.autoPlayStart')}
                            >
                                {isPlaying ? '⏸' : '▶'}
                            </button>
                        </div>

                        {/* Speed Control */}
                        <div className="flex border border-gray-200 rounded overflow-hidden ml-1" title={t('tooltip.playbackSpeed')} aria-label={t('tooltip.playbackSpeed')}>
                            {([
                                { value: 2000, label: t('ui.speedSlow') },
                                { value: 800, label: t('ui.speedNormal') },
                                { value: 400, label: t('ui.speedFast') },
                                { value: 100, label: t('ui.speedMax') },
                            ] as const).map(({ value, label }) => (
                                <button
                                    key={value}
                                    onClick={() => setPlaybackSpeed(value)}
                                    className={`px-1.5 py-1 text-[10px] transition-colors ${
                                        playbackSpeed === value
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-white text-gray-600 hover:bg-gray-100'
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>

                        {/* Branch Candidates (if multiple branches exist) */}
                        {branchCandidates.length > 1 && (
                            <div className="flex items-center gap-1 ml-2">
                                <span className="text-xs text-gray-500">{t('ui.branch')}:</span>
                                {branchCandidates.map((candidate, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => {
                                            // Navigate to this branch
                                            const targetChild = currentState.children[idx];
                                            if (targetChild) {
                                                setCurrentNodeId(targetChild.id);
                                            }
                                        }}
                                        className="w-8 h-8 rounded bg-white hover:bg-yellow-100 text-gray-800 border border-yellow-400 flex items-center justify-center font-bold text-sm shadow-sm transition-all"
                                        title={t('tooltip.branch', { value: String(candidate.value), x: String(candidate.x), y: String(candidate.y) })} aria-label={t('tooltip.branch', { value: String(candidate.value), x: String(candidate.x), y: String(candidate.y) })}
                                    >
                                        {candidate.value}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>



                {/* Tools: Coords, Size (NO NAVIGATION HERE) */}
                <div className="flex flex-col gap-1 sm:gap-2 bg-gray-50 p-1.5 sm:p-2 rounded">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowCoordinates(!showCoordinates)}
                            className={`text-xs px-2 py-1 rounded border ${showCoordinates ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300'} whitespace-nowrap`}
                        >
                            {t('ui.coords')}: {showCoordinates ? t('ui.on') : t('ui.off')}
                        </button>


                    </div>


                    {/* Size Switcher */}
                    <div className="flex items-center gap-2 pt-1 border-t border-gray-200">
                        <span className="text-xs text-gray-500">{t('ui.boardSize')}:</span>
                        {[19, 13, 9].map(s => (
                            <button
                                key={s}
                                onClick={() => setBoardSize(s)}
                                className={`text-xs px-2 py-0.5 rounded border ${boardSize === s ? 'bg-gray-700 text-white' : 'text-gray-600 border-gray-300 hover:bg-gray-200'}`}
                            >
                                {s}路
                            </button>
                        ))}
                    </div>

                    {mode === 'NUMBERED' && (
                        <div className="flex items-center gap-2 pt-1 border-t border-gray-200">
                            <label className="text-xs">{t('ui.startNumber')}:</label>
                            <input
                                type="number"
                                className="w-12 border rounded px-1 text-center"
                                value={nextNumber}
                                aria-label="Start Number"
                                onChange={(e) => setNextNumberDirectly(Math.max(1, parseInt(e.target.value) || 1))}
                            />
                        </div>
                    )}
                </div>

                {/* SGF & Export */}
                {/* Actions (Moved to Header) */}
                {/* Actions (Moved to Header) */}
                <div className="text-xs text-center text-gray-400 mt-2 space-y-1 pt-4 border-t border-gray-100">
                    <div>{t('hint.line1')}</div>
                    <div>{t('hint.line2')}</div>
                    <div>{t('hint.line3')}</div>
                    <div>{t('hint.line4')}</div>
                </div>
            </div >

            {/* Actual Print Content (Visible only during print) */}
            < div id="print-root" className={isPrintJob ? "block w-full font-serif text-sm bg-white" : "hidden print:block w-full font-serif text-sm bg-white"} >

                {/* Mode A: Current Board */}
                {
                    (!printSettings || printSettings.pagingType === 'CURRENT') && (() => {
                        // Build print board with same information as image export:
                        //   - Overlay stonesToDraw so collision positions show the EARLIEST move's number
                        //     (later moves go to the legend via hiddenMoves)
                        //   - Restore captured setup stones (not covered by stonesToDraw)
                        const printBoard: BoardState = board.map(row => row.map(s => s ? { ...s } : null));

                        for (const stone of stonesToDraw) {
                            const x = stone.x - 1;
                            const y = stone.y - 1;
                            if (y >= 0 && y < printBoard.length && x >= 0 && x < printBoard[0].length) {
                                const isNumber = !!stone.text && /^\d+$/.test(stone.text);
                                printBoard[y][x] = {
                                    color: stone.color,
                                    number: isNumber ? parseInt(stone.text) : undefined,
                                };
                            }
                        }

                        const restoredStones = getRestoredStones();
                        for (const rs of restoredStones) {
                            const x = rs.x - 1;
                            const y = rs.y - 1;
                            if (y >= 0 && y < printBoard.length && x >= 0 && x < printBoard[0].length && !printBoard[y][x]) {
                                printBoard[y][x] = {
                                    color: rs.color,
                                    number: rs.text ? parseInt(rs.text) : undefined,
                                };
                            }
                        }
                        return (
                        <div className="flex flex-col items-center w-full min-h-screen pt-12 print:pt-0">
                            {/* Header Area with Player Photos */}
                            {renderIntegratedHeader(printSettings, 1)}

                            {/* Board (legend rendered separately as HTML below) */}
                            <div className="w-full aspect-square max-w-[760px] mb-2">
                                <GoBoard
                                    boardState={printBoard}
                                    boardSize={boardSize}
                                    showCoordinates={printSettings?.showCoordinate ?? showCoordinates}
                                    showNumbers={printSettings?.showMoveNumber ?? showNumbers}
                                    markers={currentState.markers || []}
                                    specialLabels={specialLabels}
                                    onCellClick={() => { }}
                                    onCellRightClick={() => { }}
                                    onBoardWheel={() => { }}
                                    onCellMouseEnter={() => { }}
                                    onCellMouseLeave={() => { }}
                                    onDragStart={() => { }}
                                    onDragMove={() => { }}
                                    selectionStart={null}
                                    isMonochrome={printSettings?.colorMode === 'MONOCHROME'}
                                    readOnly={true}
                                />
                            </div>

                            {/* 欄外凡例（衝突手） */}
                            {hiddenMoves.length > 0 && (
                                <div
                                    style={{
                                        display: 'flex',
                                        flexWrap: 'wrap',
                                        gap: '4px 12px',
                                        width: '100%',
                                        maxWidth: 760,
                                        fontSize: 11,
                                        color: '#000',
                                        lineHeight: 1.6,
                                        marginBottom: 8,
                                        pageBreakInside: 'avoid',
                                    }}
                                >
                                    {hiddenMoves.map((item, i) => {
                                        const baseColor = item.right.color === 'BLACK' ? '#000' : '#fff';
                                        const baseTextColor = item.right.color === 'BLACK' ? '#fff' : '#000';
                                        const stoneStyle = (bg: string, fg: string): React.CSSProperties => ({
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            width: 22,
                                            height: 22,
                                            borderRadius: '50%',
                                            background: bg,
                                            color: fg,
                                            border: '1px solid #000',
                                            fontSize: 11,
                                            fontWeight: 700,
                                            lineHeight: 1,
                                            fontFamily: 'Arial, sans-serif',
                                            flex: 'none',
                                        });
                                        return (
                                            <span
                                                key={`hm-${i}`}
                                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                            >
                                                {item.left.map((stone, lidx) => {
                                                    const lc = stone.color === 'BLACK' ? '#000' : '#fff';
                                                    const ltc = stone.color === 'BLACK' ? '#fff' : '#000';
                                                    return (
                                                        <span key={`l-${lidx}`} style={stoneStyle(lc, ltc)}>{stone.text}</span>
                                                    );
                                                })}
                                                <span style={{ fontFamily: 'sans-serif' }}>=</span>
                                                <span style={stoneStyle(baseColor, baseTextColor)}>{item.right.text}</span>
                                            </span>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Footer */}
                            <div className="w-full text-center text-xs mt-auto pb-4">
                                {(printSettings?.showFooter !== false) && formatPrintString(printSettings?.footer || '')}
                            </div>
                        </div>
                        );
                    })()
                }

                {/* Mode B: Whole File */}
                {/* Mode B: Whole File */}
                {
                    (printSettings?.pagingType === 'WHOLE_FILE_FIGURE' || printSettings?.pagingType === 'WHOLE_FILE_MOVE') && (
                        <div className="flex flex-col items-center w-full pt-12 print:pt-0">
                            {(() => {
                                // Calculate Full History from Current Node to End of Variation
                                let leaf = history[history.length - 1];
                                while (leaf.children && leaf.children.length > 0) {
                                    leaf = leaf.children[0];
                                }
                                const printHistory = [];
                                let curr: import('./utils/treeUtilsV2').GameNode | null = leaf;
                                while (curr) { printHistory.unshift(curr); curr = curr.parent; }

                                const figures = generatePrintFigures(printHistory, printSettings.movesPerFigure);
                                const perPage = printSettings.figuresPerPage || 4;
                                const chunks = [];
                                for (let i = 0; i < figures.length; i += perPage) {
                                    chunks.push(figures.slice(i, i + perPage));
                                }

                                // Grid Class Logic
                                // Grid Class Logic
                                const getGridClass = (count: number) => {
                                    const layout = printSettings.layout || 'AUTO';

                                    // Forced Layouts
                                    if (layout === '1COL') return "flex flex-col gap-4 h-full items-center justify-center";
                                    if (layout === '2COL') return "grid grid-cols-2 gap-x-4 gap-y-2 h-full items-center justify-items-center align-content-center";

                                    // Auto Logic
                                    if (count === 1) return "flex justify-center items-center h-full"; // Centered single
                                    if (count === 2) {
                                        // Modified: Default to Side-by-Side (2 cols) for 2 items? 
                                        // Old logic was Vertical. But Vertical prevents Landscape usage.
                                        // Use grid-cols-2 for 2 items if we want side-by-side. 
                                        // But if they are tall boards, they get small.
                                        // Let's keep Vertical as default for Auto (Backward Compat + Portrait safety),
                                        // User can switch to 2COL for Landscape.
                                        return "grid grid-rows-2 gap-4 h-full items-center justify-items-center"; // 2 Vertical
                                    }
                                    // For 4, 6 etc:
                                    return "grid grid-cols-2 gap-x-4 gap-y-2 h-full items-center justify-items-center align-content-center";
                                };

                                // Item Max Width Logic (to fit page)
                                // A4 is roughly 210mm x 297mm.
                                // 2 cols means max width ~45%.
                                const getItemStyle = (count: number) => {
                                    const layout = printSettings.layout || 'AUTO';
                                    const isTwoCol = layout === '2COL' || (layout === 'AUTO' && count >= 3); // Auto 2 uses vertical (1 col effective width)

                                    if (isTwoCol) {
                                        // Dynamic resizing for high density (3 Rows: 5 or 6 items)
                                        if (count >= 5) {
                                            // 3 rows need to fit.
                                            // Safe limit: 260px.
                                            return { width: '90%', maxWidth: '260px' };
                                        }
                                        // 2 Rows (3 or 4 items)
                                        // 480px was too large for some margins (960px height).
                                        // Reduced to 400px (800px height) to be safe.
                                        return { width: '95%', maxWidth: '400px' };
                                    }

                                    // Single Column (1 item or Vertical Stack)
                                    if (count === 2 && layout === 'AUTO') {
                                        // Vertical Stack: Limits are vertical mostly
                                        return { width: '60%', maxWidth: '550px' };
                                    }

                                    // Default Single
                                    return { width: '90%', maxWidth: '800px' };
                                };

                                return chunks.map((chunk, pageIdx) => {
                                    const showHeader = printSettings.headerFrequency === 'EVERY_PAGE' || pageIdx === 0;

                                    return (
                                        <div key={pageIdx} className="page-break w-full min-h-screen p-4 box-border flex flex-col justify-center">
                                            {/* Page Header with Player Photos */}
                                            {showHeader && renderIntegratedHeader(printSettings, pageIdx + 1)}

                                            <div className={`${getGridClass(perPage)} w-full flex-grow`}>
                                                {chunk.map((fig, i) => {
                                                    // この図に含まれる衝突手だけを抽出（グループ内の left も範囲で絞る）
                                                    const figureLegend = hiddenMoves.flatMap(item => {
                                                        const inRange = item.left.filter(s => {
                                                            const n = parseInt(s.text);
                                                            return !isNaN(n) && n >= fig.moveRangeStart && n <= fig.moveRangeEnd;
                                                        });
                                                        if (inRange.length === 0) return [];
                                                        return [{ left: inRange, right: item.right }];
                                                    });
                                                    return (
                                                    <div key={i} className="flex flex-col items-center w-full" style={getItemStyle(perPage)}>

                                                        {/* Figure Info */}
                                                        <div className="w-full text-center font-bold text-xs mb-1">
                                                            第{(pageIdx * perPage) + i + 1}図 ({fig.moveRangeStart}-{fig.moveRangeEnd})
                                                        </div>

                                                        {/* Board */}
                                                        <div className="w-full aspect-square relative">
                                                            <GoBoard
                                                                boardState={fig.board}
                                                                boardSize={boardSize}
                                                                showCoordinates={printSettings.showCoordinate}
                                                                showNumbers={printSettings.showMoveNumber}
                                                                markers={[]}
                                                                onCellClick={() => { }}
                                                                onCellRightClick={() => { }}
                                                                onBoardWheel={() => { }}
                                                                onCellMouseEnter={() => { }}
                                                                onCellMouseLeave={() => { }}
                                                                onDragStart={() => { }}
                                                                onDragMove={() => { }}
                                                                selectionStart={null}
                                                                isMonochrome={printSettings?.colorMode === 'MONOCHROME'}
                                                            />
                                                        </div>

                                                        {/* この図の欄外凡例 */}
                                                        {figureLegend.length > 0 && (
                                                            <div
                                                                style={{
                                                                    display: 'flex',
                                                                    flexWrap: 'wrap',
                                                                    gap: '2px 8px',
                                                                    width: '100%',
                                                                    fontSize: 9,
                                                                    color: '#000',
                                                                    lineHeight: 1.4,
                                                                    marginTop: 4,
                                                                    pageBreakInside: 'avoid',
                                                                }}
                                                            >
                                                                {figureLegend.map((item, idx) => {
                                                                    const baseBg = item.right.color === 'BLACK' ? '#000' : '#fff';
                                                                    const baseFg = item.right.color === 'BLACK' ? '#fff' : '#000';
                                                                    const stoneStyle = (bg: string, fg: string): React.CSSProperties => ({
                                                                        display: 'inline-flex',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'center',
                                                                        width: 18,
                                                                        height: 18,
                                                                        borderRadius: '50%',
                                                                        background: bg,
                                                                        color: fg,
                                                                        border: '1px solid #000',
                                                                        fontSize: 9,
                                                                        fontWeight: 700,
                                                                        lineHeight: 1,
                                                                        fontFamily: 'Arial, sans-serif',
                                                                        flex: 'none',
                                                                    });
                                                                    return (
                                                                        <span
                                                                            key={`fhm-${idx}`}
                                                                            style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
                                                                        >
                                                                            {item.left.map((stone, lidx) => {
                                                                                const lb = stone.color === 'BLACK' ? '#000' : '#fff';
                                                                                const lf = stone.color === 'BLACK' ? '#fff' : '#000';
                                                                                return (
                                                                                    <span key={`l-${lidx}`} style={stoneStyle(lb, lf)}>{stone.text}</span>
                                                                                );
                                                                            })}
                                                                            <span style={{ fontFamily: 'sans-serif' }}>=</span>
                                                                            <span style={stoneStyle(baseBg, baseFg)}>{item.right.text}</span>
                                                                        </span>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}

                                                    </div>
                                                    );
                                                })}
                                            </div>

                                            {/* Footer */}
                                            <div className="w-full text-center text-[10px] mt-auto pb-4">
                                                {formatPrintString(printSettings.footer, pageIdx + 1)}
                                            </div>
                                        </div>
                                    );
                                });
                            })()}
                        </div>
                    )
                }
            </div >

            {/* Toast Notification */}
            {toast && (
                <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-bold transition-opacity duration-300 ${
                    toast.type === 'success' ? 'bg-green-600 text-white' :
                    toast.type === 'error' ? 'bg-red-600 text-white' :
                    'bg-blue-600 text-white'
                }`}>
                    {toast.message}
                </div>
            )}
            <GlobalTooltip />
        </>

    );
}

export default App

