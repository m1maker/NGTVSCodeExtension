// https://www.angelcode.com/angelscript/sdk/docs/manual/doc_script_bnf.html

// FUNC          ::= {'shared' | 'external'} ['private' | 'protected'] [((TYPE ['&']) | '~')] IDENTIFIER PARAMLIST ['const'] FUNCATTR (';' | STATBLOCK)
import {TokenObject} from "./token";
import {
    NodeASSIGN,
    NodeCONDITION,
    NodeDATATYPE,
    NodeEXPR,
    NodeEXPRTERM2, NodeFOR,
    NodeFunc,
    NodeIF,
    NodePARAMLIST,
    NodeRETURN,
    NodeScript,
    NodeSTATBLOCK,
    NodeSTATEMENT,
    NodeTYPE,
    NodeVAR, NodeWHILE
} from "./nodes";
import {diagnostic} from "../code/diagnostic";
import {HighlightModifier, HighlightToken} from "../code/highlight";

type TriedParse<T> = 'mismatch' | 'pending' | T;

class ReadingState {
    public constructor(
        private tokens: TokenObject[],
        private pos: number = 0
    ) {
    }

    public isEnd(): boolean {
        return this.pos >= this.tokens.length;
    }

    public next(): TokenObject {
        if (this.pos >= this.tokens.length) return this.tokens[this.tokens.length - 1];
        return this.tokens[this.pos];
    }

    public step() {
        this.pos++;
    }

    public confirm(analyzeToken: HighlightToken, analyzedModifier: HighlightModifier | null = null) {
        const next = this.next();
        next.highlight.token = analyzeToken;
        if (analyzedModifier !== null) next.highlight.modifier = analyzedModifier;
        this.step();
    }

    public expect(word: string, analyzeToken: HighlightToken, analyzedModifier: HighlightModifier | null = null) {
        if (this.isEnd()) {
            diagnostic.addError(this.next().location, "Unexpected end of file");
            return false;
        }
        if (this.next().kind !== "reserved") {
            diagnostic.addError(this.next().location, "Expected reserved word");
            return false;
        }
        if (this.next().text !== word) {
            diagnostic.addError(this.next().location, `Expected reserved word ${word}`);
            return false;
        }
        this.confirm(analyzeToken, analyzedModifier);
        return true;
    }
}

// SCRIPT        ::= {IMPORT | ENUM | TYPEDEF | CLASS | MIXIN | INTERFACE | FUNCDEF | VIRTPROP | VAR | FUNC | NAMESPACE | ';'}
function parseSCRIPT(reading: ReadingState) {
    const funcs: NodeFunc[] = [];
    while (reading.isEnd() === false) {
        const func = parseFUNC(reading);
        if (func === null) continue;
        funcs.push(func);
    }
    return new NodeScript(funcs);
}

// NAMESPACE     ::= 'namespace' IDENTIFIER {'::' IDENTIFIER} '{' SCRIPT '}'
// ENUM          ::= {'shared' | 'external'} 'enum' IDENTIFIER (';' | ('{' IDENTIFIER ['=' EXPR] {',' IDENTIFIER ['=' EXPR]} '}'))
// CLASS         ::= {'shared' | 'abstract' | 'final' | 'external'} 'class' IDENTIFIER (';' | ([':' IDENTIFIER {',' IDENTIFIER}] '{' {VIRTPROP | FUNC | VAR | FUNCDEF} '}'))
// TYPEDEF       ::= 'typedef' PRIMTYPE IDENTIFIER ';'

// FUNC          ::= {'shared' | 'external'} ['private' | 'protected'] [((TYPE ['&']) | '~')] IDENTIFIER PARAMLIST ['const'] FUNCATTR (';' | STATBLOCK)
function parseFUNC(reading: ReadingState) {
    const ret = parseTYPE(reading);
    if (ret === null) return null;
    const identifier = reading.next();
    reading.step();
    const paramlist = parsePARAMLIST(reading);
    const statblock = parseSTATBLOCK(reading);
    return new NodeFunc([], null, ret, null, identifier, paramlist, false, null, statblock);
}

// INTERFACE     ::= {'external' | 'shared'} 'interface' IDENTIFIER (';' | ([':' IDENTIFIER {',' IDENTIFIER}] '{' {VIRTPROP | INTFMTHD} '}'))

// VAR           ::= ['private'|'protected'] TYPE IDENTIFIER [( '=' (INITLIST | EXPR)) | ARGLIST] {',' IDENTIFIER [( '=' (INITLIST | EXPR)) | ARGLIST]} ';'
function parseVAR(reading: ReadingState): NodeVAR | null {
    const type = parseTYPE(reading);
    if (type === null) {
        diagnostic.addError(reading.next().location, "Expected type");
        return null;
    }
    const identifier = reading.next();
    reading.confirm(HighlightToken.Variable);
    reading.expect('=', HighlightToken.Operator);
    const expr = parseEXPR(reading);
    if (expr === null) {
        diagnostic.addError(reading.next().location, "Expected expression");
        return null;
    }
    reading.expect(';', HighlightToken.Operator);
    return new NodeVAR(type, identifier, expr);
}

// IMPORT        ::= 'import' TYPE ['&'] IDENTIFIER PARAMLIST FUNCATTR 'from' STRING ';'
// FUNCDEF       ::= {'external' | 'shared'} 'funcdef' TYPE ['&'] IDENTIFIER PARAMLIST ';'
// VIRTPROP      ::= ['private' | 'protected'] TYPE ['&'] IDENTIFIER '{' {('get' | 'set') ['const'] FUNCATTR (STATBLOCK | ';')} '}'
// MIXIN         ::= 'mixin' CLASS
// INTFMTHD      ::= TYPE ['&'] IDENTIFIER PARAMLIST ['const'] ';'

// STATBLOCK     ::= '{' {VAR | STATEMENT} '}'
function parseSTATBLOCK(reading: ReadingState): NodeSTATBLOCK {
    reading.expect('{', HighlightToken.Keyword);
    const statements: NodeSTATBLOCK = [];
    while (reading.isEnd() === false) {
        if (reading.next().text === '}') break;
        const statement = parseSTATEMENT(reading);
        if (statement === 'pending') {
            reading.step();
            continue;
        }
        if (statement !== 'mismatch') {
            statements.push(statement);
            continue;
        }
        const var_ = parseVAR(reading);
        if (var_ !== null) {
            statements.push(var_);
            continue;
        }
        reading.step();
    }
    reading.expect('}', HighlightToken.Keyword);
    return statements;
}

// PARAMLIST     ::= '(' ['void' | (TYPE TYPEMOD [IDENTIFIER] ['=' EXPR] {',' TYPE TYPEMOD [IDENTIFIER] ['=' EXPR]})] ')'
function parsePARAMLIST(reading: ReadingState) {
    reading.expect('(', HighlightToken.Operator);
    const params: NodePARAMLIST = [];
    for (; ;) {
        if (reading.isEnd() || reading.next().text === ')') break;
        if (params.length > 0) {
            if (reading.expect(',', HighlightToken.Operator) === false) break;
        }
        const type = parseTYPE(reading);
        if (type === null) break;
        if (reading.next().kind === 'identifier') {
            params.push([type, reading.next()]);
            reading.step();
        } else {
            params.push([type, null]);
        }
    }

    reading.expect(')', HighlightToken.Operator);
    return params;
}

// TYPEMOD       ::= ['&' ['in' | 'out' | 'inout']]

// TYPE          ::= ['const'] SCOPE DATATYPE ['<' TYPE {',' TYPE} '>'] { ('[' ']') | ('@' ['const']) }
function parseTYPE(reading: ReadingState) {
    // FIXME
    const datatype = parseDATATYPE(reading);
    if (datatype === null) return null;
    return new NodeTYPE(false, null, datatype, [], false, false);
}

// INITLIST      ::= '{' [ASSIGN | INITLIST] {',' [ASSIGN | INITLIST]} '}'
// SCOPE         ::= ['::'] {IDENTIFIER '::'} [IDENTIFIER ['<' TYPE {',' TYPE} '>'] '::']

// DATATYPE      ::= (IDENTIFIER | PRIMTYPE | '?' | 'auto')
function parseDATATYPE(reading: ReadingState) {
    // FIXME
    const next = reading.next();
    if (reading.next().kind === 'identifier') reading.confirm(HighlightToken.Type);
    else reading.confirm(HighlightToken.Builtin);
    return new NodeDATATYPE(next);
    // diagnostic.addError(next.location, "Expected identifier");
    // return null;
}

// PRIMTYPE      ::= 'void' | 'int' | 'int8' | 'int16' | 'int32' | 'int64' | 'uint' | 'uint8' | 'uint16' | 'uint32' | 'uint64' | 'float' | 'double' | 'bool'
// FUNCATTR      ::= {'override' | 'final' | 'explicit' | 'property'}

// STATEMENT     ::= (IF | FOR | WHILE | RETURN | STATBLOCK | BREAK | CONTINUE | DOWHILE | SWITCH | EXPRSTAT | TRY)
function parseSTATEMENT(reading: ReadingState): TriedParse<NodeSTATEMENT> {
    const if_ = parseIF(reading);
    if (if_ === 'pending') return 'pending';
    if (if_ instanceof NodeIF) return if_;

    const for_ = parseFOR(reading);
    if (for_ === 'pending') return 'pending';
    // if (for_ instanceof NodeFOR) return for_;

    const while_ = parseWHILE(reading);
    if (while_ === 'pending') return 'pending';
    if (while_ instanceof NodeWHILE) return while_;

    const return_ = parseRETURN(reading);
    if (return_ === 'pending') return 'pending';
    if (return_ instanceof NodeRETURN) return return_;

    return 'mismatch';
}

// SWITCH        ::= 'switch' '(' ASSIGN ')' '{' {CASE} '}'
// BREAK         ::= 'break' ';'

// FOR           ::= 'for' '(' (VAR | EXPRSTAT) EXPRSTAT [ASSIGN {',' ASSIGN}] ')' STATEMENT
function parseFOR(reading: ReadingState): TriedParse<NodeFOR> {
    if (reading.next().text !== 'for') return 'mismatch';
    reading.step();
    return new NodeFOR();
}

// WHILE         ::= 'while' '(' ASSIGN ')' STATEMENT
function parseWHILE(reading: ReadingState): TriedParse<NodeWHILE> {
    if (reading.next().text !== 'while') return 'mismatch';
    reading.step();
    reading.expect('(', HighlightToken.Operator);
    const assign = parseASSIGN(reading);
    if (assign === null) return 'pending';
    reading.expect(')', HighlightToken.Operator);
    const statement = parseSTATEMENT(reading);
    if (statement === 'mismatch' || statement === 'pending') return 'pending';
    return new NodeWHILE(assign, statement);
}

// DOWHILE       ::= 'do' STATEMENT 'while' '(' ASSIGN ')' ';'

// IF            ::= 'if' '(' ASSIGN ')' STATEMENT ['else' STATEMENT]
function parseIF(reading: ReadingState): TriedParse<NodeIF> {
    if (reading.next().text !== 'if') return 'mismatch';
    reading.step();
    reading.expect('(', HighlightToken.Operator);
    const assign = parseASSIGN(reading);
    if (assign === null) return 'pending';
    reading.expect(')', HighlightToken.Operator);
    const ts = parseSTATEMENT(reading);
    if (ts === 'mismatch' || ts === 'pending') return 'pending';
    let fs = null;
    if (reading.next().text === 'else') {
        fs = parseSTATEMENT(reading);
        if (fs === 'mismatch' || fs === 'pending') return new NodeIF(assign, ts, null);
    }
    return new NodeIF(assign, ts, fs);
}

// CONTINUE      ::= 'continue' ';'
// EXPRSTAT      ::= [ASSIGN] ';'
// TRY           ::= 'try' STATBLOCK 'catch' STATBLOCK

// RETURN        ::= 'return' [ASSIGN] ';'
function parseRETURN(reading: ReadingState): TriedParse<NodeRETURN> {
    if (reading.next().text !== 'return') return 'mismatch';
    reading.step();
    const assign = parseASSIGN(reading);
    if (assign === null) return 'pending';
    reading.expect(';', HighlightToken.Operator);
    return new NodeRETURN(assign);
}

// CASE          ::= (('case' EXPR) | 'default') ':' {STATEMENT}

// EXPR          ::= EXPRTERM {EXPROP EXPRTERM}
function parseEXPR(reading: ReadingState): NodeEXPR | null {
    const exprterm = parseEXPRTERM(reading);
    if (exprterm === null) return null;
    const exprop = parseEXPROP(reading);
    if (exprop === null) return new NodeEXPR(exprterm, null, null);
    const tail = parseEXPR(reading);
    return new NodeEXPR(exprterm, exprop, tail);
}

// EXPRTERM      ::= ([TYPE '='] INITLIST) | ({EXPRPREOP} EXPRVALUE {EXPRPOSTOP})
function parseEXPRTERM(reading: ReadingState) {
    const exprterm2 = parseEXPRTERM2(reading);
    if (exprterm2 !== null) return exprterm2;
    return null;
}

function parseEXPRTERM2(reading: ReadingState) {
    const preops = ['-', '+', '!', '++', '--', '~', '@'];
    let pre = null;
    if (preops.includes(reading.next().text)) {
        pre = reading.next();
        reading.confirm(HighlightToken.Operator);
    }

    const exprvalue = parseEXPRVALUE(reading);
    if (exprvalue === null) return null;

    const opstops = ['.', '[', '(', '++', '--'];
    let stop = null;
    if (opstops.includes(reading.next().text)) {
        stop = reading.next();
        reading.confirm(HighlightToken.Operator);
    }
    return new NodeEXPRTERM2(pre, exprvalue, stop);
}

// EXPRVALUE     ::= 'void' | CONSTRUCTCALL | FUNCCALL | VARACCESS | CAST | LITERAL | '(' ASSIGN ')' | LAMBDA
function parseEXPRVALUE(reading: ReadingState) {
    // TODO
    const next = reading.next();
    if (next.kind === 'reserved') {
        diagnostic.addError(reading.next().location, 'Expected expression value');
        return null;
    }
    reading.step();
    return next;
}

// CONSTRUCTCALL ::= TYPE ARGLIST
// EXPRPREOP     ::= '-' | '+' | '!' | '++' | '--' | '~' | '@'
// EXPRPOSTOP    ::= ('.' (FUNCCALL | IDENTIFIER)) | ('[' [IDENTIFIER ':'] ASSIGN {',' [IDENTIFIER ':' ASSIGN} ']') | ARGLIST | '++' | '--'
// CAST          ::= 'cast' '<' TYPE '>' '(' ASSIGN ')'
// LAMBDA        ::= 'function' '(' [[TYPE TYPEMOD] [IDENTIFIER] {',' [TYPE TYPEMOD] [IDENTIFIER]}] ')' STATBLOCK
// LITERAL       ::= NUMBER | STRING | BITS | 'true' | 'false' | 'null'
// FUNCCALL      ::= SCOPE IDENTIFIER ARGLIST
// VARACCESS     ::= SCOPE IDENTIFIER
// ARGLIST       ::= '(' [IDENTIFIER ':'] ASSIGN {',' [IDENTIFIER ':'] ASSIGN} ')'

// ASSIGN        ::= CONDITION [ ASSIGNOP ASSIGN ]
function parseASSIGN(reading: ReadingState): NodeASSIGN | null {
    const condition = parseCONDITION(reading);
    if (condition === null) return null;
    const op = parseASSIGNOP(reading);
    if (op === null) return new NodeASSIGN(condition, null, null);
    const assign = parseASSIGN(reading);
    return new NodeASSIGN(condition, op, assign);
}

// CONDITION     ::= EXPR ['?' ASSIGN ':' ASSIGN]
function parseCONDITION(reading: ReadingState) {
    const expr = parseEXPR(reading);
    if (expr === null) return null;
    return new NodeCONDITION(expr, null, null);
}

// CONSTRUCTCALL ::= TYPE ARGLIST

// EXPROP        ::= MATHOP | COMPOP | LOGICOP | BITOP
function parseEXPROP(reading: ReadingState) {
    const candidates = [
        '+', '-', '*', '/', '%', '**',
        '==', '!=', '<', '<=', '>', '>=', 'is',
        '&&', '||', '^^', 'and', 'or', 'xor',
        '&', '|', '^', '<<', '>>', '>>>'
    ];
    if (candidates.includes(reading.next().text) === false) return null;
    const next = reading.next();
    reading.confirm(HighlightToken.Operator);
    return next;
}

// BITOP         ::= '&' | '|' | '^' | '<<' | '>>' | '>>>'
// MATHOP        ::= '+' | '-' | '*' | '/' | '%' | '**'
// COMPOP        ::= '==' | '!=' | '<' | '<=' | '>' | '>=' | 'is' | '!is'
// LOGICOP       ::= '&&' | '||' | '^^' | 'and' | 'or' | 'xor'

// ASSIGNOP      ::= '=' | '+=' | '-=' | '*=' | '/=' | '|=' | '&=' | '^=' | '%=' | '**=' | '<<=' | '>>=' | '>>>='
function parseASSIGNOP(reading: ReadingState) {
    const candidates = [
        '=', '+=', '-=', '*=', '/=', '|=', '&=', '^=', '%=', '**=', '<<=', '>>=', '>>>='
    ];
    if (candidates.includes(reading.next().text) === false) return null;
    const next = reading.next();
    reading.confirm(HighlightToken.Operator);
    return next;
}

export function parseFromTokens(tokens: TokenObject[]): NodeScript {
    const reading = new ReadingState(tokens);
    return parseSCRIPT(reading);
}