import {LocationInfo, TokenKind} from "./tokens";
import {
    getNodeLocation,
    NodeClass,
    NodeEnum,
    NodeFunc,
    NodeIf,
    NodeInterface, NodeIntfMethod,
    NodeName,
    NodesBase,
    ParsedRange
} from "./nodes";
import {createVirtualToken, ParsingToken} from "./parsingToken";
import {diagnostic} from "../code/diagnostic";
import {numberTypeSet} from "./tokenReserves";
import assert = require("assert");

export enum SymbolKind {
    Type = 'Type',
    Function = 'Function',
    Variable = 'Variable',
}

export enum PrimitiveType {
    Template = 'Template',
    String = 'String',
    Bool = 'Bool',
    Number = 'Number',
    Void = 'Void',
    Any = 'Any',
    Auto = 'Auto',
}

export type SourceType = NodeEnum | NodeClass | NodeInterface | PrimitiveType;

export function isSourcePrimitiveType(type: SourceType | undefined): type is PrimitiveType {
    return typeof type === 'string';
}

export function isSourceNodeClassOrInterface(type: SourceType): type is NodeClass {
    if (isSourcePrimitiveType(type)) return false;
    return type.nodeName === NodeName.Class || type.nodeName === NodeName.Interface;
}

export interface SymbolicBase {
    symbolKind: SymbolKind;
    declaredPlace: ParsingToken;
}

export interface SymbolicType extends SymbolicBase {
    symbolKind: SymbolKind.Type;
    sourceType: SourceType;
    templateTypes?: ParsingToken[];
    baseList?: (DeducedType | undefined)[];
    isHandler?: boolean,
    membersScope: SymbolScope | undefined;
}

export interface SymbolicFunction extends SymbolicBase {
    symbolKind: SymbolKind.Function;
    sourceNode: NodeFunc | NodeIntfMethod;
    returnType: DeducedType | undefined;
    parameterTypes: (DeducedType | undefined)[];
    nextOverload: SymbolicFunction | undefined;
    isInstanceMember: boolean;
}

export interface SymbolicVariable extends SymbolicBase {
    symbolKind: SymbolKind.Variable;
    type: DeducedType | undefined;
    isInstanceMember: boolean;
}

export function isSymbolInstanceMember(symbol: SymbolicObject): symbol is SymbolicFunction | SymbolicVariable {
    return (symbol.symbolKind === SymbolKind.Function || symbol.symbolKind === SymbolKind.Variable)
        && symbol.isInstanceMember;
}

export type SymbolicObject = SymbolicType | SymbolicFunction | SymbolicVariable;

// (IF | FOR | WHILE | RETURN | STATBLOCK | BREAK | CONTINUE | DOWHILE | SWITCH | EXPRSTAT | TRY)
export type SymbolOwnerNode = NodeEnum | NodeClass | NodeInterface | NodeFunc | NodeIf;

export interface ReferencedSymbolInfo {
    declaredSymbol: SymbolicBase;
    referencedToken: ParsingToken;
}

export type ScopeMap = Map<string, SymbolScope>;

export type SymbolMap = Map<string, SymbolicObject>;

// 親ノードと親スコープ
export interface ScopeBirthInfo {
    ownerNode: SymbolOwnerNode | undefined;
    parentScope: SymbolScope | undefined;
}

// 定義されたシンボル情報と小スコープ
export interface ScopeContainInfo {
    childScopes: ScopeMap;
    symbolMap: SymbolMap;
}

// 参照情報や補完情報
export interface ScopeServiceInfo {
    referencedList: ReferencedSymbolInfo[];
    completionHints: ComplementHints[];
}

export interface SymbolScope extends ScopeBirthInfo, ScopeContainInfo, ScopeServiceInfo {
}

export interface SymbolAndScope {
    symbol: SymbolicObject;
    scope: SymbolScope;
}

export function insertSymbolicObject(map: SymbolMap, symbol: SymbolicObject): boolean {
    const identifier = symbol.declaredPlace.text;
    const hit = map.get(identifier);
    if (hit === undefined) {
        map.set(identifier, symbol);
        return true;
    }
    const canOverload = symbol.symbolKind === SymbolKind.Function && hit.symbolKind === SymbolKind.Function;
    if (canOverload === false) {
        diagnostic.addError(symbol.declaredPlace.location, `Symbol '${identifier}' is already defined 💢`);
        return false;
    }

    // 関数はオーバーロードとして追加が可能
    let cursor = hit;
    for (; ;) {
        if (cursor.nextOverload === undefined) {
            cursor.nextOverload = symbol;
            return true;
        }
        cursor = cursor.nextOverload;
    }
}

export type TemplateTranslation = Map<ParsingToken, DeducedType | undefined>;

export function resolveTemplateType(
    templateTranslate: TemplateTranslation, type: DeducedType | undefined
): DeducedType | undefined {
    if (type === undefined) return undefined;

    if (type.symbolType.symbolKind === SymbolKind.Function) return undefined; // FIXME: 関数ハンドラのテンプレート解決も必要?

    if (type.symbolType.sourceType !== PrimitiveType.Template) return type;

    if (templateTranslate.has(type.symbolType.declaredPlace)) {
        return templateTranslate.get(type.symbolType.declaredPlace);
    }
    return type;
}

export function resolveTemplateTypes(
    templateTranslate: (TemplateTranslation | undefined)[], type: DeducedType | undefined
) {
    return templateTranslate
        .reduce((arg, t) => t !== undefined ? resolveTemplateType(t, arg) : arg, type);
}

export interface DeducedType {
    symbolType: SymbolicType | SymbolicFunction;
    sourceScope: SymbolScope | undefined;
    isHandler?: boolean;
    templateTranslate?: TemplateTranslation;
}

export function isDeducedAutoType(type: DeducedType | undefined): boolean {
    return type !== undefined && type.symbolType.symbolKind === SymbolKind.Type && type.symbolType.sourceType === PrimitiveType.Auto;
}

export function stringifyDeducedType(type: DeducedType | undefined): string {
    if (type === undefined) return '(undefined)';

    let surffix = '';
    if (type.isHandler === true) return surffix = `${surffix}@`;

    if (type.symbolType.symbolKind === SymbolKind.Function) {
        const func: SymbolicFunction = type.symbolType;
        const returnType = func.returnType;
        const params = func.parameterTypes.map(t => stringifyDeducedType(t)).join(', ');
        return `${stringifyDeducedType(returnType)}(${params})` + surffix;
    }

    if (type.templateTranslate !== undefined) {
        surffix = `<${Array.from(type.templateTranslate.values()).map(t => stringifyDeducedType(t)).join(', ')}>${surffix}`;
    }

    return type.symbolType.declaredPlace.text + surffix;
}

export function stringifyDeducedTypes(types: (DeducedType | undefined)[]): string {
    return types.map(t => stringifyDeducedType(t)).join(', ');
}

export enum ComplementKind {
    Scope = 'Scope',
    Type = 'Type',
    Namespace = 'Namespace',
}

export interface ComplementBase {
    complementKind: ComplementKind;
    complementLocation: LocationInfo;
}

export interface ComplementScope extends ComplementBase {
    complementKind: ComplementKind.Scope;
    targetScope: SymbolScope;
}

export function hintsCompletionScope(parentScope: SymbolScope | undefined, targetScope: SymbolScope, nodeRange: ParsedRange) {
    parentScope?.completionHints.push({
        complementKind: ComplementKind.Scope,
        complementLocation: getNodeLocation(nodeRange),
        targetScope: targetScope
    });
}

export interface ComplementType extends ComplementBase {
    complementKind: ComplementKind.Type;
    targetType: SymbolicType;
}

export interface CompletionNamespace extends ComplementBase {
    complementKind: ComplementKind.Namespace;
    namespaceList: ParsingToken[];
}

export type ComplementHints = ComplementScope | ComplementType | CompletionNamespace;

function createBuiltinType(virtualToken: ParsingToken, name: PrimitiveType): SymbolicType {
    return {
        symbolKind: SymbolKind.Type,
        declaredPlace: virtualToken,
        sourceType: name,
        membersScope: undefined,
    } as const;
}

const builtinNumberTypeMap: Map<string, SymbolicType> = (() => {
    const map = new Map<string, SymbolicType>();
    for (const name of numberTypeSet) {
        map.set(name, createBuiltinType(createVirtualToken(TokenKind.Reserved, name), PrimitiveType.Number));
    }
    return map;
})();

export const builtinStringType: SymbolicType = createBuiltinType(createVirtualToken(TokenKind.String, 'string'), PrimitiveType.String);

export const builtinIntType = builtinNumberTypeMap.get('int')!;

export const builtinFloatType = builtinNumberTypeMap.get('float')!;

export const builtinDoubleType = builtinNumberTypeMap.get('double')!;

function assignBuiltinNumberType(key: string): SymbolicType {
    const type = builtinNumberTypeMap.get(key);
    if (type !== undefined) return type;
    assert(false);
}

export const builtinBoolType: SymbolicType = createBuiltinType(createVirtualToken(TokenKind.Reserved, 'bool'), PrimitiveType.Bool);

export const builtinVoidType: SymbolicType = createBuiltinType(createVirtualToken(TokenKind.Reserved, 'void'), PrimitiveType.Void);

export const builtinAnyType: SymbolicType = createBuiltinType(createVirtualToken(TokenKind.Reserved, '?'), PrimitiveType.Any);

export const builtinAutoType: SymbolicType = createBuiltinType(createVirtualToken(TokenKind.Reserved, 'auto'), PrimitiveType.Auto);

export function tryGetBuiltInType(token: ParsingToken): SymbolicType | undefined {
    if (token.kind !== TokenKind.Reserved) return undefined;

    const identifier = token.text;
    if ((identifier === 'bool')) return builtinBoolType;
    else if ((identifier === 'void')) return builtinVoidType;
    else if (identifier === '?') return builtinAnyType;
    else if (identifier === 'auto') return builtinAutoType;
    else if (token.kind === TokenKind.Reserved && token.property.isNumber) return assignBuiltinNumberType(identifier);

    return undefined;
}

export const builtinThisToken = createVirtualToken(TokenKind.Identifier, 'this');

export function findSymbolShallowly(scope: SymbolScope, identifier: string): SymbolicObject | undefined {
    return scope.symbolMap.get(identifier);
}

export function getSymbolAndScopeIfExist(symbol: SymbolicObject | undefined, scope: SymbolScope): SymbolAndScope | undefined {
    if (symbol === undefined) return undefined;
    return {symbol: symbol, scope: scope};
}

export function findSymbolWithParent(scope: SymbolScope, identifier: string): SymbolAndScope | undefined {
    const symbol = scope.symbolMap.get(identifier);
    if (symbol !== undefined) return {symbol: symbol, scope: scope};
    if (scope.parentScope === undefined) return undefined;
    return findSymbolWithParent(scope.parentScope, identifier);
}
