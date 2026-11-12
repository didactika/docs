/**
 * Keeps the identifiers of the tables (UC-001, RF-002, RN-007...) on one line: a hyphen is a place where a browser may break a
 * line, and in a narrow column it did, leaving "UC-" and "001" on two lines.
 */
import {visit} from 'unist-util-visit';
import {toString} from 'hast-util-to-string';

const IDENTIFIER = /^[A-Z]{2,5}-\d{2,4}$/;

export default function rehypeNowrapIds() {
    return (tree: unknown) => {
        visit(tree as never, 'element', (node: {tagName: string; properties?: Record<string, unknown>}) => {
            if ((node.tagName === 'td' || node.tagName === 'th') && IDENTIFIER.test(toString(node as never).trim())) {
                node.properties = {...node.properties, className: ['nowrap']};
            }
        });
    };
}
