import React, { type FC } from 'react';
import Box from '@mui/material/Box';
import ButtonGroup from '@mui/material/ButtonGroup';
import IconButton from '@mui/material/IconButton';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import AutoStoriesIcon from '@mui/icons-material/AutoStories';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import CollectionsBookmarkIcon from '@mui/icons-material/CollectionsBookmark';
import classNames from 'classnames';

import { appRouter } from 'components/router/appRouter';
import itemHelper from 'components/itemHelper';
import globalize from 'lib/globalize';
import { getReadablePrimaryActionUi, isReadableItem } from 'utils/readableActionUi';
import { playbackManager } from 'components/playback/playbackmanager';
import { ItemAction } from 'constants/itemAction';
import PlayedButton from 'elements/emby-playstatebutton/PlayedButton';
import FavoriteButton from 'elements/emby-ratingbutton/FavoriteButton';

import PlayArrowIconButton from '../../common/PlayArrowIconButton';
import MoreVertIconButton from '../../common/MoreVertIconButton';

import type { ItemDto } from 'types/base/models/item-dto';
import type { CardOptions } from 'types/cardOptions';

const getReadableMuiIcon = (iconName: string) => {
    switch (iconName) {
        case 'picture_as_pdf':
            return <PictureAsPdfIcon />;
        case 'auto_stories':
            return <AutoStoriesIcon />;
        case 'collections_bookmark':
            return <CollectionsBookmarkIcon />;
        default:
            return <MenuBookIcon />;
    }
};


interface CardHoverMenuProps {
    action: ItemAction,
    item: ItemDto;
    cardOptions: CardOptions;
}

const CardHoverMenu: FC<CardHoverMenuProps> = ({
    action,
    item,
    cardOptions
}) => {
    const url = appRouter.getRouteUrl(item, {
        parentId: cardOptions.parentId
    });
    const btnCssClass =
        'paper-icon-button-light cardOverlayButton cardOverlayButton-hover itemAction';

    const centerPlayButtonClass = classNames(
        btnCssClass,
        'cardOverlayFab-primary'
    );
    const { IsFavorite, Played } = item.UserData ?? {};

    return (
        <Box
            className='cardOverlayContainer itemAction'
            data-action={action}
        >
            <a
                href={url}
                aria-label={item.Name || ''}
                className='cardImageContainer'
            ></a>

            {playbackManager.canPlay(item) && (() => {
                const isReadable = isReadableItem(item);
                const isResumable = !!(item.UserData && item.UserData.PlaybackPositionTicks && item.UserData.PlaybackPositionTicks > 0);
                const readableUi = isReadable ? getReadablePrimaryActionUi(item, isResumable, globalize) : null;

                if (readableUi) {
                    return (
                        <IconButton
                            className={centerPlayButtonClass}
                            data-action={ItemAction.Play}
                            title={readableUi.title}
                        >
                            {getReadableMuiIcon(readableUi.icon)}
                        </IconButton>
                    );
                }

                return (
                    <PlayArrowIconButton
                        className={centerPlayButtonClass}
                        action={ItemAction.Play}
                        title='Play'
                    />
                );
            })()}

            <ButtonGroup className='cardOverlayButton-br flex'>
                {itemHelper.canMarkPlayed(item) && cardOptions.enablePlayedButton !== false && (
                    <PlayedButton
                        className={btnCssClass}
                        isPlayed={Played}
                        itemId={item.Id}
                        itemType={item.Type}
                        queryKey={cardOptions.queryKey}
                    />
                )}

                {itemHelper.canRate(item) && cardOptions.enableRatingButton !== false && (
                    <FavoriteButton
                        className={btnCssClass}
                        isFavorite={IsFavorite}
                        itemId={item.Id}
                        queryKey={cardOptions.queryKey}
                    />
                )}

                <MoreVertIconButton className={btnCssClass} />
            </ButtonGroup>
        </Box>
    );
};

export default CardHoverMenu;
