// React 19 removed the global `JSX` namespace — JSX types now live under
// `React.JSX`. This codebase uses the global `JSX.Element` return-type
// annotation in ~225 files; rather than churn every one (and add a React
// import to each, since the automatic JSX runtime doesn't import React), we
// re-expose the global namespace as an alias of `React.JSX`. This is the
// migration shim documented in the React 19 upgrade guide and keeps
// `JSX.IntrinsicElements` augmentable by third-party libraries.
import "react";

declare global {
  namespace JSX {
    interface Element extends React.JSX.Element {}
    interface ElementClass extends React.JSX.ElementClass {}
    interface ElementAttributesProperty extends React.JSX.ElementAttributesProperty {}
    interface ElementChildrenAttribute extends React.JSX.ElementChildrenAttribute {}
    type LibraryManagedAttributes<C, P> = React.JSX.LibraryManagedAttributes<C, P>;
    interface IntrinsicAttributes extends React.JSX.IntrinsicAttributes {}
    interface IntrinsicClassAttributes<T> extends React.JSX.IntrinsicClassAttributes<T> {}
    interface IntrinsicElements extends React.JSX.IntrinsicElements {}
  }
}
