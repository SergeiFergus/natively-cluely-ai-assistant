/**
 * OPEN re-implementation of the premium KnowledgeDatabaseManager.
 *
 * Thin persistence layer over the app's existing better-sqlite3 handle (passed
 * by electron/main.ts as `new KnowledgeDatabaseManagerClass(sqliteDb)`). Stores
 * ingested résumé/JD documents, their structured extractions, and per-chunk
 * embeddings for semantic grounding. No proprietary code — authored against the
 * public constructor call-site.
 */

import { DocType, KnowledgeDocRecord, StructuredProfileFacts, StructuredJobFacts } from './types';

interface ChunkRow {
    id: string;
    docId: string;
    ord: number;
    text: string;
    embedding: number[] | null;
}

export class KnowledgeDatabaseManager {
    public readonly db: any;

    constructor(sqliteDb: any) {
        this.db = sqliteDb;
        this.ensureSchema();
    }

    private ensureSchema(): void {
        // IF NOT EXISTS everywhere — safe to run on every boot. Namespaced with
        // an `oss_` prefix so it never collides with any table the upstream
        // premium build (or a future one) might create.
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS oss_knowledge_docs (
                id           TEXT PRIMARY KEY,
                doc_type     TEXT NOT NULL,
                file_name    TEXT,
                raw_text     TEXT,
                structured   TEXT,
                created_at   INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS oss_knowledge_chunks (
                id           TEXT PRIMARY KEY,
                doc_id       TEXT NOT NULL,
                ord          INTEGER NOT NULL,
                text         TEXT NOT NULL,
                embedding    TEXT,
                created_at   INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_oss_knowledge_docs_type ON oss_knowledge_docs(doc_type);
            CREATE INDEX IF NOT EXISTS idx_oss_knowledge_chunks_doc ON oss_knowledge_chunks(doc_id);
        `);
    }

    saveDoc(rec: KnowledgeDocRecord): void {
        this.db
            .prepare(
                `INSERT OR REPLACE INTO oss_knowledge_docs (id, doc_type, file_name, raw_text, structured, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(
                rec.id,
                rec.docType,
                rec.fileName,
                rec.rawText,
                rec.structured ? JSON.stringify(rec.structured) : null,
                rec.createdAt,
            );
    }

    /** Most-recent document of a type, or null. */
    latestDoc(docType: DocType): KnowledgeDocRecord | null {
        const row: any = this.db
            .prepare(
                `SELECT * FROM oss_knowledge_docs WHERE doc_type = ? ORDER BY created_at DESC LIMIT 1`,
            )
            .get(docType);
        if (!row) return null;
        return {
            id: row.id,
            docType: row.doc_type as DocType,
            fileName: row.file_name,
            rawText: row.raw_text,
            structured: row.structured ? JSON.parse(row.structured) : null,
            createdAt: row.created_at,
        };
    }

    deleteByType(docType: DocType): void {
        const docs: any[] = this.db
            .prepare(`SELECT id FROM oss_knowledge_docs WHERE doc_type = ?`)
            .all(docType);
        const delChunks = this.db.prepare(`DELETE FROM oss_knowledge_chunks WHERE doc_id = ?`);
        for (const d of docs) delChunks.run(d.id);
        this.db.prepare(`DELETE FROM oss_knowledge_docs WHERE doc_type = ?`).run(docType);
    }

    saveChunks(docId: string, chunks: Array<{ ord: number; text: string; embedding: number[] | null }>): void {
        const now = Date.now();
        const stmt = this.db.prepare(
            `INSERT OR REPLACE INTO oss_knowledge_chunks (id, doc_id, ord, text, embedding, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
        );
        const tx = this.db.transaction((rows: any[]) => {
            for (const r of rows) {
                stmt.run(
                    `${docId}:${r.ord}`,
                    docId,
                    r.ord,
                    r.text,
                    r.embedding ? JSON.stringify(r.embedding) : null,
                    now,
                );
            }
        });
        tx(chunks);
    }

    /** All embedded chunks for a document type (joined across its docs). */
    chunksForType(docType: DocType): ChunkRow[] {
        const rows: any[] = this.db
            .prepare(
                `SELECT c.* FROM oss_knowledge_chunks c
                 JOIN oss_knowledge_docs d ON d.id = c.doc_id
                 WHERE d.doc_type = ?`,
            )
            .all(docType);
        return rows.map((r) => ({
            id: r.id,
            docId: r.doc_id,
            ord: r.ord,
            text: r.text,
            embedding: r.embedding ? JSON.parse(r.embedding) : null,
        }));
    }
}
