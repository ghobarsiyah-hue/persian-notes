import { Link, useParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { WIKI_ARTICLES, WIKI_SECTION, findArticle } from '@/wiki/articles';

/**
 * راهنما / Wiki — plain Persian help. One calm column: the article index,
 * or a single article. No cards, no icons for decoration, no dashboard.
 */
export function HelpPage() {
  const { articleId } = useParams();
  const article = articleId ? findArticle(articleId) : undefined;

  return (
    <div className="pn-app-bg min-h-screen" dir="rtl">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Link
          to={article ? '/help' : '/'}
          className="inline-flex items-center gap-1.5 text-sm text-ink-500 transition hover:text-ink-800 dark:text-ink-400 dark:hover:text-ink-200"
        >
          <ArrowRight size={15} aria-hidden="true" />
          {article ? 'همه مقاله‌ها' : 'بازگشت'}
        </Link>

        <h1 className="mt-5 text-xl font-extrabold tracking-tight text-ink-900 dark:text-ink-100">
          {WIKI_SECTION}
        </h1>

        {article ? (
          <article className="mt-6">
            <p className="text-xs text-ink-500 dark:text-ink-400">{article.section}</p>
            <h2 className="mt-1 text-lg font-bold text-ink-900 dark:text-ink-100">{article.title}</h2>
            <div className="mt-4 space-y-3">
              {article.body.map((p, i) => (
                <p key={i} className="text-sm leading-7 text-gray-700 dark:text-gray-300">
                  {p}
                </p>
              ))}
            </div>
          </article>
        ) : (
          <nav className="mt-6" aria-label="فهرست مقاله‌ها">
            <ul className="divide-y divide-black/5 dark:divide-white/5">
              {WIKI_ARTICLES.map((a) => (
                <li key={a.id}>
                  <Link
                    to={`/help/${a.id}`}
                    className="group flex items-baseline justify-between gap-3 py-3"
                  >
                    <span className="text-sm font-medium text-ink-900 transition group-hover:text-accent-700 dark:text-ink-100 dark:group-hover:text-accent-300">
                      {a.title}
                    </span>
                    <span className="shrink-0 text-xs text-ink-500 dark:text-ink-400">{a.section}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </div>
  );
}
