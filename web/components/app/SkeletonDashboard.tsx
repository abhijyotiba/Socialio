export function SkeletonDashboard() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 pb-10">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="skeleton h-10 w-10 rounded-xl" />
          <div className="space-y-1.5">
            <div className="skeleton h-6 w-32 rounded-lg" />
            <div className="skeleton h-3 w-48 rounded-md" />
          </div>
        </div>
        <div className="skeleton h-9 w-28 rounded-xl" />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="skeleton h-32 rounded-2xl" />
        <div className="skeleton h-32 rounded-2xl" />
        <div className="skeleton h-32 rounded-2xl" />
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="skeleton h-64 rounded-2xl lg:col-span-3" />
        <div className="skeleton h-64 rounded-2xl lg:col-span-2" />
      </div>
    </div>
  );
}

export function SkeletonQueue() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="skeleton h-10 w-10 rounded-xl" />
          <div className="space-y-1.5">
            <div className="skeleton h-6 w-28 rounded-lg" />
            <div className="skeleton h-3 w-40 rounded-md" />
          </div>
        </div>
        <div className="skeleton h-9 w-24 rounded-xl" />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className="skeleton h-28 rounded-2xl" />
        <div className="skeleton h-28 rounded-2xl" />
      </div>

      {/* Tabs */}
      <div className="skeleton h-11 rounded-xl" />

      {/* Queue items */}
      <div className="space-y-2.5">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton h-20 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

export function SkeletonProfile() {
  return (
    <div className="mx-auto w-full max-w-3xl pb-12">
      <div className="skeleton h-52 rounded-2xl" />
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <div className="skeleton h-48 rounded-2xl" />
          <div className="skeleton h-40 rounded-2xl" />
        </div>
        <div className="space-y-4 lg:col-span-2">
          <div className="skeleton h-32 rounded-2xl" />
          <div className="skeleton h-40 rounded-2xl" />
          <div className="skeleton h-36 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
