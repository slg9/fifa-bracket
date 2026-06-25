type BootLoaderMarkProps = {
  className?: string
}

export function BootLoaderMark({ className = 'boot-loader__mark' }: BootLoaderMarkProps) {
  return (
    <div className={className} aria-hidden="true">
      <span className="boot-loader__orbit boot-loader__orbit--outer" />
      <span className="boot-loader__orbit boot-loader__orbit--inner" />
      <img className="boot-loader__logo" src="/brakup-loader.svg" alt="" />
    </div>
  )
}

export default BootLoaderMark
