/** Pure predicates shared by the indexer pipeline and the head overlay. */

const TEST_PATH = /(^|\/)(__tests__|__mocks__|test|tests|e2e|spec)(\/|$)/i;
const TEST_FILE = /\.(test|spec|it\.test)\.[cm]?[jt]sx?$/i;

/**
 * Is this file a test rather than production code?
 *
 * Used to keep `file_facts` honest. `extractEndpoints` matches any
 * `app.get('/x')` / `api.get('/x')` shape, which a test suite is full of — so
 * without this filter a repo's endpoint list fills up with assertions like
 * `GET /articles?limit=1000`, `GET /articles/not-a-uuid` and
 * `DELETE /articles/${id}`. Those are calls INTO an API, not registrations of
 * one, and presenting them as impacted endpoints is simply wrong.
 *
 * Deliberately path- and suffix-based only: reading the file to decide would
 * cost a parse per file on the indexer's hot path for a question the layout
 * already answers.
 */
export function isTestFile(path: string): boolean {
  return TEST_PATH.test(path) || TEST_FILE.test(path);
}
